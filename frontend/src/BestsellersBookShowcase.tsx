// The registered ThreeUI export, using the same typography recipe and frame.
// The parent-only customization bridge supports its opaque srcDoc sandbox.
import { useMemo } from 'react'
import { PAGE_CUSTOMIZATION_BRIDGE, splitTypographyProps, usePageTypography, type PageTypographyProps } from '../vendor/threeui/src/shaders/landing-pages/pageTypography'
import { LandingPageFrame, type LandingPageProps } from '../vendor/threeui/src/shaders/landing-pages/LandingPageFrame'
import { BESTSELLERS_TYPOGRAPHY } from '../vendor/threeui/src/shaders/landing-pages/pageRecipes'

export function BestsellersBookShowcase(props: LandingPageProps & PageTypographyProps) {
  const [type, frame] = splitTypographyProps(props)
  const customization = usePageTypography(BESTSELLERS_TYPOGRAPHY, type)
  const srcDoc = useMemo(() => frame.srcDoc?.replace('</body>', `${PAGE_CUSTOMIZATION_BRIDGE.replace('var detail = event.data;', 'if (event.source !== window.parent) return;\n  var detail = event.data;')}\n</body>`), [frame.srcDoc])
  return <LandingPageFrame {...frame} srcDoc={srcDoc} customization={customization} title="ICARUS — Ignite your mind" sourceUrl="/landing-pages/bestsellers-book-showcase.html" />
}
