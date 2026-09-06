"use client";

export default function HeroWidgets() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden xl:block">
      {/* Top Left - Yellow Sticky Note with Check Button */}
      <div className="absolute left-[2%] top-[4%] hidden md:left-[3%] md:top-[6%] md:block">
        {/* 3D Board Shadow/Silhouette */}
        <div
          className="absolute -bottom-[0.5rem] left-[0.5rem] h-[10rem] w-[10rem] rounded-[1rem] bg-black/5 blur-md md:h-[12rem] md:w-[12rem] md:rounded-[1.5rem]"
          style={{
            transform: 'rotate(-6deg)',
          }}
        />

        {/* White paper sheets behind (layered) */}
        <div
          className="absolute left-0 top-0 h-[10rem] w-[10rem] rounded-[1rem] bg-white md:h-[12rem] md:w-[12rem] md:rounded-[1.5rem]"
          style={{
            transform: 'rotate(-8deg)',
            boxShadow:
              '0 0.125rem 0.25rem rgba(0,0,0,0.1),' +
              '0 0.5rem 1rem rgba(0,0,0,0.08),' +
              '0 1rem 2.5rem rgba(0,0,0,0.06)',
          }}
        />

        {/* Yellow sticky note */}
        <div
          className="absolute left-[0.75rem] top-[0.75rem] h-[9rem] w-[9rem] rounded-[1rem] bg-gradient-to-b from-yellow-100 to-yellow-200 p-[1rem] md:h-[11rem] md:w-[11rem] md:p-[1.25rem]"
          style={{
            transform: 'rotate(-4deg)',
            boxShadow:
              '0 0.25rem 0.375rem rgba(0,0,0,0.12),' +
              '0 0.75rem 1.25rem rgba(0,0,0,0.1),' +
              '0 1.5rem 3rem rgba(0,0,0,0.08)',
          }}
        >
          {/* Red pushpin */}
          <div
            className="absolute left-1/2 top-[0.5rem] h-[0.75rem] w-[0.75rem] -translate-x-1/2 rounded-full bg-red-500"
            style={{
              boxShadow: '0 0.125rem 0.25rem rgba(220,38,38,0.5), 0 0.0625rem 0.125rem rgba(0,0,0,0.3)',
            }}
          />

          {/* Handwritten text */}
          <div className="font-handwriting text-sm leading-relaxed text-gray-800 md:text-base">
            <p>
              Research first.
              <br />
              Written by hand.
              <br />
              Real results.
            </p>
          </div>
        </div>

        {/* Blue check button overlapping bottom-left */}
        <div
          className="absolute bottom-[0.5rem] left-[1.5rem] flex h-[4rem] w-[4rem] items-center justify-center rounded-[1.25rem] bg-white md:h-[5rem] md:w-[5rem] md:rounded-[1.5rem]"
          style={{
            transform: 'rotate(-6deg)',
            boxShadow:
              '0 0.25rem 0.5rem rgba(0,0,0,0.12),' +
              '0 0.75rem 1.5rem rgba(0,0,0,0.1),' +
              '0 1.5rem 3rem rgba(0,0,0,0.08)',
          }}
        >
          <div className="flex h-[2.75rem] w-[2.75rem] items-center justify-center rounded-[0.75rem] bg-gradient-to-br from-blue-500 to-blue-600 md:h-[3.5rem] md:w-[3.5rem] md:rounded-xl">
            <svg
              className="h-[1.5rem] w-[1.5rem] md:h-[1.75rem] md:w-[1.75rem]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>
      </div>

      {/* Top Right - Reminder Card */}
      <div className="absolute right-[2%] top-[4%] hidden md:right-[3%] md:top-[6%] md:block">
        {/* 3D Board Shadow/Silhouette */}
        <div
          className="absolute -bottom-[0.5rem] right-[0.5rem] h-[8rem] w-[14rem] rounded-[1rem] bg-black/5 blur-md md:h-[10rem] md:w-[18rem] md:rounded-[1.5rem]"
          style={{
            transform: 'rotate(2deg)',
          }}
        />

        <div
          className="relative w-[14rem] rounded-[1rem] bg-white p-[1rem] md:w-[18rem] md:rounded-[1.5rem] md:p-[1.25rem]"
          style={{
            transform: 'rotate(2deg)',
            boxShadow:
              '0 0.25rem 0.375rem rgba(0,0,0,0.1),' +
              '0 0.75rem 1.5rem rgba(0,0,0,0.09),' +
              '0 1.5rem 3rem rgba(0,0,0,0.07)',
          }}
        >
          <div className="mb-[0.75rem] text-[0.625rem] font-semibold uppercase tracking-wider text-gray-500">
            Reminders
          </div>
          <div className="flex items-start gap-[0.75rem]">
            <div
              className="flex h-[2.75rem] w-[2.75rem] shrink-0 items-center justify-center rounded-[0.75rem] bg-gray-100 md:h-[3.5rem] md:w-[3.5rem] md:rounded-xl"
              style={{
                boxShadow: 'inset 0 0.125rem 0.25rem rgba(0,0,0,0.06)',
              }}
            >
              <svg
                className="h-[1.5rem] w-[1.5rem] md:h-[1.75rem] md:w-[1.75rem]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#4f4bff"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-gray-900 md:text-sm">
                Today&apos;s Meeting
              </div>
              <div className="text-[0.625rem] text-gray-600 md:text-xs">Call with marketing team</div>
              <div className="mt-[0.375rem] text-xs font-semibold text-accent md:text-sm">13:00 - 13:45</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Left - Today's Tasks */}
      <div className="absolute bottom-[15%] left-[2%] hidden md:bottom-[18%] md:left-[3%] md:block">
        {/* 3D Board Shadow/Silhouette */}
        <div
          className="absolute -bottom-[0.5rem] left-[0.5rem] h-[8rem] w-[16rem] rounded-[1rem] bg-black/5 blur-md md:h-[10rem] md:w-[18.75rem] md:rounded-[1.5rem]"
          style={{
            transform: 'rotate(-1deg)',
          }}
        />

        <div
          className="relative w-[16rem] rounded-[1rem] bg-white p-[1rem] md:w-[18.75rem] md:rounded-[1.5rem] md:p-[1.25rem]"
          style={{
            transform: 'rotate(-1deg)',
            boxShadow:
              '0 0.25rem 0.375rem rgba(0,0,0,0.1),' +
              '0 0.75rem 1.5rem rgba(0,0,0,0.09),' +
              '0 1.5rem 3rem rgba(0,0,0,0.07)',
          }}
        >
          <div className="mb-[1rem] text-[0.625rem] font-semibold uppercase tracking-wider text-gray-500 md:text-xs">
            Today&apos;s Pipeline
          </div>
          <div className="space-y-[0.75rem]">
            {/* Task 1 */}
            <div className="flex items-center gap-[0.75rem]">
              <div
                className="h-[0.625rem] w-[0.625rem] shrink-0 rounded-full bg-red-500"
                style={{
                  boxShadow: '0 0 0 0.1875rem rgba(239,68,68,0.15)',
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-gray-900 md:text-sm">
                  ICP Research
                </div>
                <div className="text-[0.625rem] text-gray-500 md:text-xs">Sep 10</div>
              </div>
              <div className="text-sm font-bold text-accent md:text-base">60%</div>
            </div>

            {/* Task 2 */}
            <div className="flex items-center gap-[0.75rem]">
              <div
                className="h-[0.625rem] w-[0.625rem] shrink-0 rounded-full bg-green-500"
                style={{
                  boxShadow: '0 0 0 0.1875rem rgba(34,197,94,0.15)',
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-gray-900 md:text-sm">
                  Design PPT #4
                </div>
                <div className="text-[0.625rem] text-gray-500 md:text-xs">Sep 18</div>
              </div>
              <div className="text-sm font-bold text-accent md:text-base">112%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Right - Integrations */}
      <div className="absolute bottom-[15%] right-[2%] hidden md:bottom-[18%] md:right-[3%] md:block">
        {/* 3D Board Shadow/Silhouette */}
        <div
          className="absolute -bottom-[0.5rem] right-[0.5rem] h-[8rem] w-[16rem] rounded-[1rem] bg-black/5 blur-md md:h-[10rem] md:w-[18.75rem] md:rounded-[1.5rem]"
          style={{
            transform: 'rotate(1deg)',
          }}
        />

        <div
          className="relative w-[16rem] rounded-[1rem] bg-white p-[1rem] md:w-[18.75rem] md:rounded-[1.5rem] md:p-[1.25rem]"
          style={{
            transform: 'rotate(1deg)',
            boxShadow:
              '0 0.25rem 0.375rem rgba(0,0,0,0.1),' +
              '0 0.75rem 1.5rem rgba(0,0,0,0.09),' +
              '0 1.5rem 3rem rgba(0,0,0,0.07)',
          }}
        >
          <div className="mb-[1rem] text-[0.625rem] font-semibold uppercase tracking-wider text-gray-500 md:text-xs">
            100+ Integrations
          </div>
          <div className="flex gap-[0.75rem]">
            <div
              className="flex h-[4rem] w-[4rem] items-center justify-center rounded-[0.75rem] bg-white md:h-[5rem] md:w-[5rem] md:rounded-xl"
              style={{
                boxShadow:
                  '0 0.125rem 0.25rem rgba(0,0,0,0.06),' +
                  '0 0.25rem 0.75rem rgba(0,0,0,0.05)',
                border: '0.0625rem solid rgba(0,0,0,0.04)',
              }}
            >
              <span className="text-2xl">📧</span>
            </div>
            <div
              className="flex h-[4rem] w-[4rem] items-center justify-center rounded-[0.75rem] bg-white md:h-[5rem] md:w-[5rem] md:rounded-xl"
              style={{
                boxShadow:
                  '0 0.125rem 0.25rem rgba(0,0,0,0.06),' +
                  '0 0.25rem 0.75rem rgba(0,0,0,0.05)',
                border: '0.0625rem solid rgba(0,0,0,0.04)',
              }}
            >
              <span className="text-2xl">💬</span>
            </div>
            <div
              className="flex h-[4rem] w-[4rem] items-center justify-center rounded-[0.75rem] bg-white md:h-[5rem] md:w-[5rem] md:rounded-xl"
              style={{
                boxShadow:
                  '0 0.125rem 0.25rem rgba(0,0,0,0.06),' +
                  '0 0.25rem 0.75rem rgba(0,0,0,0.05)',
                border: '0.0625rem solid rgba(0,0,0,0.04)',
              }}
            >
              <span className="text-2xl">📅</span>
            </div>
          </div>
        </div>
      </div>

      {/* Center Right - App Integrations Emerging Widget */}
      <div className="absolute right-[1%] top-1/2 hidden -translate-y-1/2 md:right-[2%] lg:block">
        {/* 3D Board Shadow */}
        <div
          className="absolute -bottom-[0.25rem] right-[0.25rem] h-[6rem] w-[4rem] rounded-[0.75rem] bg-black/4 blur-lg"
          style={{
            transform: 'rotate(-3deg)',
          }}
        />

        {/* Vertical app icons stack */}
        <div className="flex flex-col gap-[0.75rem]">
          {/* Google Drive Icon */}
          <div
            className="flex h-[3.5rem] w-[3.5rem] items-center justify-center rounded-[0.75rem] bg-white transition-transform duration-300 hover:scale-110 md:h-[4rem] md:w-[4rem] md:rounded-xl"
            style={{
              transform: 'rotate(-2deg)',
              boxShadow:
                '0 0.125rem 0.25rem rgba(0,0,0,0.08),' +
                '0 0.25rem 0.5rem rgba(0,0,0,0.06),' +
                '0 0.5rem 1rem rgba(0,0,0,0.04)',
            }}
          >
            <svg className="h-[1.75rem] w-[1.75rem] md:h-[2rem] md:w-[2rem]" viewBox="0 0 48 48" fill="none">
              <path d="M15 8L24 24L15 40L0 24L15 8Z" fill="#0066DA"/>
              <path d="M33 8L48 24L33 40L24 24L33 8Z" fill="#00AC47"/>
              <path d="M24 24L33 40H15L24 24Z" fill="#EA4335"/>
              <path d="M24 24L15 8H33L24 24Z" fill="#FFBA00"/>
            </svg>
          </div>

          {/* Notion Icon */}
          <div
            className="flex h-[3.5rem] w-[3.5rem] items-center justify-center rounded-[0.75rem] bg-white transition-transform duration-300 hover:scale-110 md:h-[4rem] md:w-[4rem] md:rounded-xl"
            style={{
              transform: 'rotate(2deg)',
              boxShadow:
                '0 0.125rem 0.25rem rgba(0,0,0,0.08),' +
                '0 0.25rem 0.5rem rgba(0,0,0,0.06),' +
                '0 0.5rem 1rem rgba(0,0,0,0.04)',
            }}
          >
            <svg className="h-[1.75rem] w-[1.75rem] md:h-[2rem] md:w-[2rem]" viewBox="0 0 48 48" fill="none">
              <rect x="8" y="8" width="32" height="32" rx="6" fill="black"/>
              <path d="M20 16L28 24L20 32" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          {/* Asana Icon */}
          <div
            className="flex h-[3.5rem] w-[3.5rem] items-center justify-center rounded-[0.75rem] bg-white transition-transform duration-300 hover:scale-110 md:h-[4rem] md:w-[4rem] md:rounded-xl"
            style={{
              transform: 'rotate(-3deg)',
              boxShadow:
                '0 0.125rem 0.25rem rgba(0,0,0,0.08),' +
                '0 0.25rem 0.5rem rgba(0,0,0,0.06),' +
                '0 0.5rem 1rem rgba(0,0,0,0.04)',
            }}
          >
            <svg className="h-[1.75rem] w-[1.75rem] md:h-[2rem] md:w-[2rem]" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="16" r="6" fill="#F06A6A"/>
              <circle cx="16" cy="28" r="6" fill="#F06A6A"/>
              <circle cx="32" cy="28" r="6" fill="#F06A6A"/>
            </svg>
          </div>
        </div>
      </div>

    </div>
  );
}
