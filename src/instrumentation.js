const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { SimpleLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || 'my-node-app',

    // 1. Traces
    traceExporter: new OTLPTraceExporter(),

    // 2. Metrics
    metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
    }),

    // 3. Logs
    logRecordProcessors: [
        new SimpleLogRecordProcessor(new OTLPLogExporter()),
    ],

    // Auto-discover DB, HTTP, and local library calls
    instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
console.log("OpenTelemetry SDK started (Logs, Metrics, Traces)");