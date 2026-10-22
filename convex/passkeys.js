'use node';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {action} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {v,ConvexError} from 'convex/values';
import {relyingParty} from './lib/identity.js';

const responseArg=v.any();
function checkResponse(response){
  if(!response||typeof response.id!=='string'||JSON.stringify(response).length>20000)throw new ConvexError('That room-key response is not valid. Please try again.');
}
export const registrationOptions=action({args:{token:v.string(),origin:v.string()},handler:async(ctx,args)=>{
  const info=await ctx.runQuery(internal.identity.registrationContext,args);
  const options=await generateRegistrationOptions({rpName:'Little Lobby',rpID:info.rpId,userName:info.name,userDisplayName:info.name,
    userID:new TextEncoder().encode(info.playerId),attestationType:'none',supportedAlgorithmIDs:[-7,-257],
    authenticatorSelection:{residentKey:'required',userVerification:'required'},
    excludeCredentials:info.keys.map(key=>({id:key.credentialId,transports:key.transports}))});
  const id=await ctx.runMutation(internal.identity.storeChallenge,{...args,purpose:'register',challenge:options.challenge});
  return {id,options};
}});
export const register=action({args:{token:v.string(),id:v.id('identityChallenges'),response:responseArg},handler:async(ctx,{token,id,response})=>{
  checkResponse(response);
  const request=await ctx.runMutation(internal.identity.takeChallenge,{id,purpose:'register',token});
  let result;
  try{result=await verifyRegistrationResponse({response,expectedChallenge:request.challenge,expectedOrigin:request.origin,expectedRPID:request.rpId,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});}
  catch{throw new ConvexError('Your room key could not be verified. Please try again.');}
  if(!result.verified||!result.registrationInfo)throw new ConvexError('Your room key could not be verified.');
  const {credential}=result.registrationInfo;
  return ctx.runMutation(internal.identity.savePasskey,{token,playerId:request.playerId,credentialId:credential.id,
    publicKey:Buffer.from(credential.publicKey).toString('base64url'),counter:credential.counter,transports:credential.transports??[],rpId:request.rpId});
}});
export const authenticationOptions=action({args:{origin:v.string()},handler:async(ctx,{origin})=>{
  const {rpId}=relyingParty(origin);
  const options=await generateAuthenticationOptions({rpID:rpId,userVerification:'required'});
  const id=await ctx.runMutation(internal.identity.storeChallenge,{origin,purpose:'authenticate',challenge:options.challenge});
  return {id,options};
}});
export const authenticate=action({args:{id:v.id('identityChallenges'),response:responseArg},handler:async(ctx,{id,response})=>{
  checkResponse(response);
  const request=await ctx.runMutation(internal.identity.takeChallenge,{id,purpose:'authenticate'});
  const key=await ctx.runQuery(internal.identity.credential,{credentialId:response.id});
  if(!key||key.rpId!==request.rpId)throw new ConvexError('That room key does not belong to a character at this address.');
  if(response.response?.userHandle&&Buffer.from(response.response.userHandle,'base64url').toString('utf8')!==key.playerId)throw new ConvexError('That room key does not match this character.');
  let result;
  try{result=await verifyAuthenticationResponse({response,expectedChallenge:request.challenge,expectedOrigin:request.origin,expectedRPID:request.rpId,requireUserVerification:true,
    credential:{id:key.credentialId,publicKey:new Uint8Array(Buffer.from(key.publicKey,'base64url')),counter:key.counter,transports:key.transports}});}
  catch{throw new ConvexError('Your room key could not be verified. Please try again.');}
  if(!result.verified)throw new ConvexError('Your room key could not be verified.');
  return ctx.runMutation(internal.identity.signIn,{credentialId:key.credentialId,previousCounter:key.counter,counter:result.authenticationInfo.newCounter});
}});
