// Three missed heartbeats tolerate background-tab throttling and brief network drops.
export const HEARTBEAT_INTERVAL=30000;
export const CONNECTION_TIMEOUT=90000;
// Existing leases keep their original deadline until the next heartbeat upgrades them.
export const connectionTimeout=connection=>connection.timeoutMs??45000;
export const connectionAlive=(connection,now)=>connection.lastSeen+connectionTimeout(connection)>now;
