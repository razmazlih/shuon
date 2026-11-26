export function NumberField({
  name,
  title,
  value,
  max,
  min = 0,
  required = false,
  step = '0.01',
  hint,
}: {
  name: string
  title: string
  value?: number | null
  min?: number | null
  max?: number
  required?: boolean
  step?: string
  hint?: string
}) {
  return (
    <label className="salary-field">
      <span>{title}</span>
      <input
        type="number"
        key={value ?? ''}
        name={name}
        min={min ?? undefined}
        max={max}
        step={step}
        required={required}
        inputMode="decimal"
        defaultValue={value ?? ''}
        placeholder={hint}
      />
    </label>
  )
}

export function readNumber(data: FormData, key: string) {
  const value = data.get(key)
  return value === null || value === '' ? null : Number(value)
}
