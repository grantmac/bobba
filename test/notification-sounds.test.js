import {describe,it,expect,vi} from 'vitest';
import {createNotificationSounds} from '../src/notification-sounds.js';

function setup(){
  const parameter=()=>({setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()});
  const context={state:'suspended',currentTime:10,destination:{},
    resume:vi.fn(async()=>{context.state='running';}),close:vi.fn(async()=>{context.state='closed';}),
    createOscillator:vi.fn(()=>({frequency:parameter(),connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()})),
    createGain:vi.fn(()=>({gain:parameter(),connect:vi.fn(),disconnect:vi.fn()}))};
  const createContext=vi.fn(()=>context);
  return {sound:createNotificationSounds({createContext}),context,createContext};
}
describe('join chime',()=>{
  it('uses a shorter message tone and mutes both notifications immediately',async()=>{
    const {sound,context}=setup();await sound.unlock();await sound.play('message');
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    sound.setMuted(true);await sound.play();await sound.play('message');
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    expect(context.createOscillator.mock.results[0].value.stop).toHaveBeenLastCalledWith();
    sound.setMuted(false);await sound.play();expect(context.createOscillator).toHaveBeenCalledTimes(3);
  });
  it('remembers the mute preference across reloads',()=>{
    const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
    const sound=createNotificationSounds({storage});expect(sound.muted).toBe(false);
    sound.setMuted(true);expect(createNotificationSounds({storage}).muted).toBe(true);
    sound.setMuted(false);expect(createNotificationSounds({storage}).muted).toBe(false);
  });
  it('requires a user gesture and schedules every arrival on the audio clock',async()=>{
    const {sound,context,createContext}=setup();
    await sound.play();expect(createContext).not.toHaveBeenCalled();
    await sound.unlock();expect(context.resume).toHaveBeenCalledTimes(1);
    await sound.play();await sound.play();
    const notes=context.createOscillator.mock.results.map(result=>result.value);
    expect(notes).toHaveLength(4);
    expect(notes.map(note=>note.start.mock.calls[0][0])).toEqual([10,10.14,10.5,10.64]);
    notes[0].onended();expect(notes[0].disconnect).toHaveBeenCalled();
    expect(context.createGain.mock.results[0].value.disconnect).toHaveBeenCalled();
  });
  it('recovers from suspended audio and handles blocked audio without throwing',async()=>{
    const {sound,context}=setup();await sound.unlock();
    context.state='suspended';context.resume.mockRejectedValueOnce(new Error('blocked'));
    await expect(sound.play()).resolves.toBeUndefined();expect(context.createOscillator).not.toHaveBeenCalled();
    await sound.unlock();await sound.play();expect(context.createOscillator).toHaveBeenCalledTimes(2);
  });
  it('does not play a stale arrival after a delayed resume or after closing',async()=>{
    const {sound,context}=setup();await sound.unlock();context.state='suspended';
    let resume;context.resume.mockImplementation(()=>new Promise(resolve=>{resume=()=>{context.state='running';resolve();};}));
    const now=vi.spyOn(Date,'now').mockReturnValue(1000);
    try{
      const pending=sound.play();now.mockReturnValue(4000);resume();await pending;
      expect(context.createOscillator).not.toHaveBeenCalled();
      context.state='suspended';const closing=sound.play();sound.close();resume();await closing;
      expect(context.createOscillator).not.toHaveBeenCalled();expect(context.close).toHaveBeenCalledTimes(1);
    }finally{now.mockRestore();}
  });
});
