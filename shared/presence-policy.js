// Allow delayed background timers and brief network drops without flickering presence.
// Clean tab departures still disconnect immediately.
export const HEARTBEAT_INTERVAL=30000;
export const CONNECTION_TIMEOUT=5*60*1000;
// Existing leases keep their original deadline until the next heartbeat upgrades them.
export const connectionTimeout=connection=>connection.timeoutMs??45000;
export const connectionAlive=(connection,now)=>connection.lastSeen+connectionTimeout(connection)>now;
