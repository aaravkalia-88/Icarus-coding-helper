// The Kage export from the verified ThreeUI bundle, with ICARUS's frame title.
// The complete registered LandingPages.tsx stays intact in vendor/threeui.
import { useMemo } from 'react'
import { PAGE_CUSTOMIZATION_BRIDGE, splitTypographyProps, usePageTypography, type PageTypographyProps } from '../vendor/threeui/src/shaders/landing-pages/pageTypography'
import { LandingPageFrame, type LandingPageProps } from '../vendor/threeui/src/shaders/landing-pages/LandingPageFrame'
import { KAGE_TYPOGRAPHY } from '../vendor/threeui/src/shaders/landing-pages/pageRecipes'

export function KageLandingPage(props: LandingPageProps & PageTypographyProps) {
  const [type, frame] = splitTypographyProps(props);
  const customization = usePageTypography(KAGE_TYPOGRAPHY, type);
  const srcDoc = useMemo(() => frame.srcDoc?.replace('</body>', `${PAGE_CUSTOMIZATION_BRIDGE.replace('var detail = event.data;', 'if (event.source !== window.parent) return;\n  var detail = event.data;')}\n</body>`), [frame.srcDoc]);
  return <LandingPageFrame {...frame} srcDoc={srcDoc} customization={customization} title="ICARUS — Your coding workspace" sourceUrl="/landing-pages/kage.html" />;
}
