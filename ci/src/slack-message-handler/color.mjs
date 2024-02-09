export function statusColor(event) {
  switch (event.detail['build-status']) {
    case 'IN_PROGRESS':
      return '#daa038';
    case 'SUCCEEDED':
      return '#2eb886';
    case 'FAILED':
      return '#a30200';
    case 'STOPPED':
      return '#a30200';
    default:
      return '#daa038';
  }
}
