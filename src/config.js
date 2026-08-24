// POC configuration. No real credentials are committed here.
export default {
  // Your web SDK Key (by client mode). The page host must be registered for
  // this key — for local testing, localhost works out of the box.
  SDK_KEY: 'YOUR_SDK_KEY',

  // Optional hostname override sent to the SDK. Empty = window.location.origin.
  HOSTNAME: '',

  // DEV | UAT | PROD
  SDK_ENVIRONMENT: 'UAT',

  // Your IDPay company UUID (transaction owner).
  COMPANY_ID: 'YOUR_COMPANY_ID',

  // Collection identification.
  USE_CASE: 'idpay-silent-flow-poc-react',

  // Grace period (ms) after the prepare for the SDK fire-and-forget upload to
  // leave the device. Counted in background; the transaction only waits for
  // whatever is still remaining.
  GRACE_MS: 5000,
};
