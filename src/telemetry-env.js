// Preloaded by `npm start` BEFORE @opentelemetry/auto-instrumentations-node/register.
//
// Why this file exists: the auto-instrumentation reads the standard OTEL_* variables,
// but our .env uses the Dash0 names (DASH0_OTLP_ENDPOINT, DASH0_TOKEN). Nothing mapped
// one to the other and nothing loaded .env before the SDK started, so no traces reached
// Dash0. This runs first, loads .env (real environment variables win), and sets the
// OTEL_* names. Anything already set in the environment is left alone.
require('dotenv').config({ quiet: true });

const setDefault = (name, value) => {
  if (value && !process.env[name]) process.env[name] = value;
};

const endpoint = process.env.DASH0_OTLP_ENDPOINT;
const token = process.env.DASH0_TOKEN;

if (endpoint && token) {
  // Port 4317 is OTLP/gRPC, 4318 is OTLP/HTTP. Dash0 accepts both on the same host.
  const protocol = /:4318\b/.test(endpoint) ? 'http/protobuf' : 'grpc';
  setDefault('OTEL_EXPORTER_OTLP_ENDPOINT', endpoint);
  setDefault('OTEL_EXPORTER_OTLP_PROTOCOL', protocol);
  setDefault('OTEL_EXPORTER_OTLP_HEADERS', `Authorization=Bearer ${token}`);
} else {
  // Without a Dash0 endpoint and token the SDK would retry localhost:4317 and spam errors.
  setDefault('OTEL_TRACES_EXPORTER', 'none');
  setDefault('OTEL_METRICS_EXPORTER', 'none');
  setDefault('OTEL_LOGS_EXPORTER', 'none');
  console.warn('[telemetry] DASH0_OTLP_ENDPOINT / DASH0_TOKEN not set: traces are disabled.');
}

setDefault('OTEL_SERVICE_NAME', 'rightroom');
setDefault(
  'OTEL_RESOURCE_ATTRIBUTES',
  `deployment.environment.name=${process.env.NODE_ENV || 'development'}`
);
// Server, Express and the Elasticsearch client (undici) are the spans we want;
// fs/dns/net instrumentation only adds noise to the Dash0 views.
setDefault('OTEL_NODE_ENABLED_INSTRUMENTATIONS', 'http,express,undici');
// Skip cloud resource detectors (GCP/AWS/Azure metadata lookups): they stall startup and
// log errors on laptops. env/host/os/process are enough for the Dash0 resource view.
setDefault('OTEL_NODE_RESOURCE_DETECTORS', 'env,host,os,process,serviceinstance');
