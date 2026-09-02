'use client'

import { getName } from 'country-list'
import { getCountries, getCountryCallingCode } from 'libphonenumber-js/min'

type PhoneFieldProps = {
  defaultCountry?: string
  defaultValue?: string
  /** Message for this field, when the action rejected the number. */
  error?: string
}

// country-list ships one static ISO dataset. Avoid Intl.DisplayNames here:
// server and browser ICU versions can spell a territory differently, which
// causes a hydration mismatch inside the <select>.
const countries = getCountries()
  .map((code) => ({
    code,
    name: getName(code)?.replace(/ \(the\)$/i, '') ?? code,
    callingCode: `+${getCountryCallingCode(code)}`,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))

export function PhoneField({
  defaultCountry = 'US',
  defaultValue = '',
  error,
}: PhoneFieldProps) {
  const safeDefault = countries.some((country) => country.code === defaultCountry)
    ? defaultCountry
    : 'US'

  return (
    <fieldset className="space-y-1.5">
      <legend className="block text-sm font-medium text-ink">Phone number</legend>
      <div
        className={`auth-clay-field grid grid-cols-[minmax(132px,0.48fr)_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-md)] border-0 bg-clay-sunken shadow-[var(--neo-shadow-inset)] transition-shadow duration-150 focus-within:shadow-[var(--neo-shadow-focus)]${
          error ? ' ring-1 ring-danger' : ''
        }`}
      >
        <label className="sr-only" htmlFor="phone_country">Country code</label>
        <select
          id="phone_country"
          name="phone_country"
          defaultValue={safeDefault}
          autoComplete="tel-country-code"
          className="min-w-0 border-r border-border bg-transparent px-3 py-2.5 text-sm font-semibold text-ink outline-none [color-scheme:light]"
          required
        >
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name} ({country.callingCode})
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="phone">Phone number</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required
          maxLength={30}
          placeholder="Phone number"
          defaultValue={defaultValue}
          aria-describedby={`phone-hint${error ? ' phone-error' : ''}`}
          aria-invalid={error ? true : undefined}
          className="min-w-0 bg-transparent px-3 py-2.5 text-base text-ink outline-none placeholder:text-muted/60"
        />
      </div>
      <p id="phone-hint" className="text-xs leading-relaxed text-muted">
        Choose your country, then enter the local number. We store it securely in international format.
      </p>
      {error ? (
        <p id="phone-error" className="flex gap-1.5 text-xs leading-relaxed text-danger">
          <span aria-hidden="true">↳</span>
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  )
}
