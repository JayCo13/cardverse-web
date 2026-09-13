export function noDataLabel(locale?: string) {
  if (locale === 'ja-JP') return 'データなし';
  if (locale === 'en-US') return 'No data available';
  return 'Chưa có dữ liệu';
}
