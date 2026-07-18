const ORANGE = '\x1b[38;5;208m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const ART = String.raw`
  ____           _   ____
 |  _ \ ___  ___| |_| __ )  _____  __
 | |_) / _ \/ __| __|  _ \ / _ \ \/ /
 |  __/ (_) \__ \ |_| |_) | (_) >  <
 |_|   \___/|___/\__|____/ \___/_/\_\
`

export function printBanner(version: string): void {
  console.log(ORANGE + ART + RESET)
  console.log(`  ${BOLD}${CYAN}:: A Project by KD ::${RESET}${DIM}          (v${version})${RESET}`)
  console.log(
    `${DIM}  API client + Chrome network recorder — https://github.com/MrKousikDebnath/postbox${RESET}\n`
  )
}
