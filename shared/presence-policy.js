// Quiet connections become away before they depart. Clean tab departures are immediate.
export const HEARTBEAT_INTERVAL=30000;
export const AWAY_AFTER=5*60*1000;
export const CONNECTION_TIMEOUT=15*60*1000;
// Existing leases keep their original deadline until the next heartbeat upgrades them.
export const connectionTimeout=connection=>connection.timeoutMs??45000;
export const connectionAlive=(connection,now)=>connection.lastSeen+connectionTimeout(connection)>now;
export const connectionActive=(connection,now)=>connection.lastSeen+(connection.awayAfterMs??connectionTimeout(connection))>now;
