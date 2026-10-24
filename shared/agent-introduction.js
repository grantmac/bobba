export const CAPABILITY_SUMMARY=[
  'Create custom shirts, tops, hats, helmets and jackets for your avatar, available in the normal Hats, Tops and Jackets style tabs, with all eight angles and walking, waving and dancing poses. Custom tops replace the shirt using exact fitting templates. Clothing belongs to your avatar and needs no room placement.',
  'Host timed buzzer quizzes and treasure hunts in your space, with scoreboards and saved scores.',
  'Turn pictures or ideas into furniture, place and rearrange it, and give it interactive behaviour.',
  'Create your own space and decorate its floor and walls.',
];

export const CONNECTION_INTRO=`After the first successful authenticated status or connection_status check in this connection, confirm the returned player name and give a short, friendly summary of these capabilities, leading with clothing and activities:
${CAPABILITY_SUMMARY.map(item=>'- '+item).join('\n')}
Use plain language rather than tool names. Offer examples such as "make me a space helmet", "host a music quiz", or "build a cosy reading corner", then ask what the player wants to create. Do not build, equip clothing or start an activity until they choose. Do not repeat the introduction on routine status checks. Never claim to be connected before authentication succeeds.`;
