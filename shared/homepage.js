// Stable identities connect the study's furniture to its stories, even after moving it.
export const HOMEPAGE_SPACE_ID='grant-homepage';
export const homepageTopicFor=item=>item?.id?.startsWith('homepage-')?HOMEPAGE_TOPICS[item.id.slice(9)]??null:null;
export const HOMEPAGE_TOPICS={desk:'now',computer:'now',telephone:'contact',shelf:'projects',clippings:'clippings',records:'music',record:'music',trophy:'music',bike:'cycling',oldcomputer:'oldweb',oldDesk:'oldweb',guestbook:'guestbook',suggestions:'suggestions'};
export const HOMEPAGE_PIECES=[
  {id:'desk',type:'lc_desk',x:1,z:1,rotation:4},
  {id:'computer',type:'hc26_computer',x:1,z:1,rotation:4,support:'desk'},
  {id:'telephone',type:'homepage_telephone',x:2,z:1,rotation:4,support:'desk'},
  {id:'deskchair',type:'small_chair_armas',x:1,z:2,rotation:0},
  {id:'clippings',type:'noticeboard',x:0,z:0,rotation:0},
  {id:'shelf',type:'grunge_shelf',x:4,z:0,rotation:4},
  {id:'records',type:'custom_dj_table',x:5,z:3,rotation:4},
  {id:'record',type:'song_disk',x:5,z:3,rotation:0,support:'records'},
  {id:'trophy',type:'prizetrophy_music',x:6,z:3,rotation:0,support:'records'},
  {id:'oldDesk',type:'lc_desk',x:1,z:5,rotation:4},
  {id:'oldcomputer',type:'custom_macintosh',x:1,z:5,rotation:4,support:'oldDesk'},
  {id:'guestbook',type:'custom_logbook',x:2,z:5,rotation:4,support:'oldDesk'},
  {id:'readingchair',type:'small_chair_armas',x:1,z:6,rotation:0},
  {id:'bike',type:'homepage_bike',x:6,z:5,rotation:2},
  {id:'suggestions',type:'glukko_book2',x:4,z:6,rotation:0},
  {id:'plant',type:'plant_cruddy',x:7,z:0,rotation:0},
  {id:'rug',type:'exe_rug',x:3,z:3,rotation:0},
];
