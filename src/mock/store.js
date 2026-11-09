// shortcut: in-memory, single process; all state is lost on restart. Swap this module for an Elasticsearch store when P1/P2 are ready.
const { seed } = require('./seed');

const store = { db: seed() };
store.reset = (now) => { store.db = seed(now); return store.db; };

module.exports = store;
