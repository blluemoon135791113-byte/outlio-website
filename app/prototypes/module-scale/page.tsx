import { ExtractionJourney } from '@/components/leadengine/ExtractionJourney'
import { HubbleIntelligence } from '@/components/leadengine/HubbleIntelligence'
import { OutreachAutomation } from '@/components/leadengine/OutreachAutomation'
import { PlatformOverview } from '@/components/leadengine/PlatformOverview'
import { Pricing } from '@/components/leadengine/Pricing'
import { LeadLibrary } from '@/components/leadengine/LeadLibrary'
import { ScalePreview } from './ScalePreview'

export default async function ModuleScalePage({ searchParams }: {
  searchParams: Promise<{ v?: string }>
}) {
  const { v } = await searchParams
  return (
    <ScalePreview initialVariant={v === '2' ? 'compact' : 'clay'}>
      <div data-module="overview" id="sample-overview"><PlatformOverview /></div>
      <div data-module="extraction" id="sample-extraction"><ExtractionJourney /></div>
      <div data-module="hubble" id="sample-hubble"><HubbleIntelligence /></div>
      <div data-module="outbound" id="sample-outbound"><OutreachAutomation /></div>
      <div data-module="pricing" id="sample-pricing"><Pricing /></div>
      <div data-module="library" id="sample-library"><LeadLibrary /></div>
    </ScalePreview>
  )
}
