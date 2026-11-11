// Never encrypt/store an outbox operation from a blocked or incomplete directory.
export function requireDeliveryReady(result, deviceId) {
  if (result?.ready !== true || !Array.isArray(result.devices) ||
      !result.devices.some(d => d.deviceId === deviceId && d.isCurrentDevice)) {
    throw Object.assign(new Error('Messaging delivery directory is not ready'),
      {code:'message_delivery_directory_not_ready'});
  }
}
