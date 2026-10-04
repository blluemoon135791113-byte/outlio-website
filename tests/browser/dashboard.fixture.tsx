import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { FormDialog } from '@/components/crm/FormDialog'
import { ProductShell } from '@/components/product/ProductShell'
import { SettingsShell } from '@/components/settings/SettingsShell'

// Actual product components, fabricated content. No auth, analytics or database calls.
function DashboardFixture() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [renders, setRenders] = useState(0)
  const settings = new URLSearchParams(location.search).has('settings')
  const content = (
    <>
      <button type="button" onClick={() => setDialogOpen(true)}>Open test form</button>
      <div className="overflow-x-auto" data-testid="wide-table">
        <table className="min-w-[1200px]"><tbody><tr><td>Fabricated table</td><td>Last column</td></tr></tbody></table>
      </div>
      {Array.from({ length: 60 }, (_, i) => <p className="py-4" key={i}>Dashboard row {i + 1}</p>)}
      <button type="button">End of dashboard</button>
      {dialogOpen ? (
        <FormDialog label="Test form" onClose={() => setDialogOpen(false)}>
          <div className="clay p-5">
            <input type="hidden" name="pipelineId" value="fixture-pipeline" />
            <input disabled aria-label="Disabled form field" />
            <input aria-label="First form field" />
            <button type="button" onClick={() => setRenders((n) => n + 1)}>Update form ({renders})</button>
            {Array.from({ length: 30 }, (_, i) => <p className="py-4" key={i}>Form row {i + 1}</p>)}
            <input aria-label="Last form field" />
            <button type="button" onClick={() => setDialogOpen(false)}>Close test form</button>
          </div>
        </FormDialog>
      ) : null}
    </>
  )
  return (
    <ProductShell
      userId="fixture-user"
      email="tester@example.com"
      fullName="Dashboard Tester"
      planName="Test plan"
      isAdmin
      canUseScraper
      showCrm
      showEmail
      showLinkedIn
      showFlows
      referralLink="https://example.com/ref/fabricated"
    >
      {settings ? <SettingsShell title="Test settings" description="Fabricated settings content">{content}</SettingsShell> : content}
    </ProductShell>
  )
}

createRoot(document.getElementById('root')!).render(<DashboardFixture />)
