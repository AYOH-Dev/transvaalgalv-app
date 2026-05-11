/**
 * White-label configuration.
 * To rebrand for a different client, update the values in this file only.
 */

import logoSvg from '../assets/transvaal-logo.svg'
import logoPng from '../assets/transvaal.png'
import ayohLogo from '../assets/ayoh.png'

export const BRAND = {
  /** Short app name — shown in sidebar, login card, browser title */
  name: 'Transvaal Galv',

  /** Full legal / display name — shown on login page heading */
  fullName: 'Transvaal Galvanisers',

  /** Location tag shown in the Yard receiving top-bar */
  location: 'Nigel',

  /** Sidebar sub-label below the brand name */
  sub: 'Management',

  /** Two-letter monogram for compact/icon-only contexts */
  monogram: 'TG',

  /** SVG logo (sidebar, login icon container) */
  logoSvg,

  /** PNG logo (login card, general image use) */
  logoPng,

  /** Support footer link / "powered by" logo */
  ayohLogo,

  /** External AYOH link shown in login footer */
  ayohUrl: 'https://ayoh.group/',
} as const
