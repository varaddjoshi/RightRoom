// shortcut: in-memory, single process; all state is lost on restart. Swap this module for an Elasticsearch store when P1/P2 are ready.
const { seed } = require('./seed');
const { seedInto } = require('./insights-seed');

// Stand-in Wi-Fi readings and comments come back on every reset, so insights never go empty mid-demo.
const fresh = (now) => seedInto(seed(now));
const store = { db: fresh() };
store.reset = (now) => { store.db = fresh(now); return store.db; };

module.exports = store;
