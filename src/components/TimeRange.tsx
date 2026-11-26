type TimeRangeProps = {
  start: string
  end?: string
}

export function TimeRange({ start, end }: TimeRangeProps) {
  return (
    <bdi dir="rtl" className="time-range">
      <bdi dir="ltr">{start}</bdi>
      {end !== undefined && (
        <>
          {' – '}
          <bdi dir="ltr">{end}</bdi>
        </>
      )}
    </bdi>
  )
}
