function getTimestamp(record) {
  if (typeof record.timestamp === "number" && Number.isFinite(record.timestamp)) {
    return record.timestamp;
  }

  const timestamp = Date.parse(record.timestamp ?? "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sortTelemetryHistoryNewestFirst(records) {
  return [...records].sort((first, second) => {
    const firstTimestamp = getTimestamp(first);
    const secondTimestamp = getTimestamp(second);

    if (firstTimestamp === null && secondTimestamp !== null) return 1;
    if (firstTimestamp !== null && secondTimestamp === null) return -1;
    if (firstTimestamp !== secondTimestamp) {
      return secondTimestamp - firstTimestamp;
    }

    return String(second.id ?? "").localeCompare(String(first.id ?? ""));
  });
}
