"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Command } from "cmdk"
import { Check, ChevronsUpDown, Globe2, Search } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const REGION_CODES =
  "AF AX AL DZ AS AD AO AI AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI XK KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(" ")

const NAME_OVERRIDES: Record<string, string> = { HK: "Hong Kong", MO: "Macao", MM: "Myanmar", PS: "Palestine" }

const ALIASES: Record<string, string[]> = {
  US: ["USA", "America", "United States of America"],
  GB: ["UK", "Britain", "England", "Scotland", "Wales", "Northern Ireland"],
  AE: ["UAE", "Emirates"],
  KR: ["Korea"],
  NL: ["Holland"],
  CZ: ["Czech Republic"],
  CD: ["DRC", "Congo"],
  CG: ["Congo"],
}

// Strong swimming nations surface first, alongside the visitor's own region.
const SUGGESTED_CODES = ["US", "AU", "GB", "CA", "CN", "JP", "FR", "IT", "NL", "DE"]

type Country = { code: string; name: string }

const buildCountries = (): Country[] => {
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" })
  return REGION_CODES.map((code) => ({ code, name: NAME_OVERRIDES[code] || displayNames.of(code) || code })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

// Match on name, ISO code and aliases only (item values are internal ids), best matches first.
const rankCountry = (_value: string, search: string, keywords?: string[]) => {
  const query = search.trim().toLowerCase()
  if (!query) return 1
  const terms = (keywords || []).map((term) => term.toLowerCase())
  if (terms.includes(query)) return 1
  if (terms.some((term) => term.startsWith(query))) return 0.9
  if (terms.some((term) => term.split(/[\s-]+/).some((word) => word.startsWith(query)))) return 0.7
  if (terms.some((term) => term.includes(query))) return 0.4
  return 0
}

function Flag({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-4 w-6 shrink-0 overflow-hidden rounded-[4px] bg-white/10 ring-1 ring-white/15",
        className,
      )}
    >
      <img
        src={`https://flagcdn.com/${code.toLowerCase()}.svg`}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden"
        }}
      />
    </span>
  )
}

export function CountrySelect({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [highlighted, setHighlighted] = useState("")
  const [detectedCode, setDetectedCode] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const countries = useMemo(buildCountries, [])
  const selected = countries.find((country) => country.name === value)

  useEffect(() => {
    const region = navigator.language?.split("-")[1]?.toUpperCase()
    if (region && REGION_CODES.includes(region)) setDetectedCode(region)
  }, [])

  const suggested = useMemo(() => {
    const codes = detectedCode ? [detectedCode, ...SUGGESTED_CODES.filter((code) => code !== detectedCode)] : SUGGESTED_CODES
    return codes.map((code) => countries.find((country) => country.code === code)).filter(Boolean) as Country[]
  }, [countries, detectedCode])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setSearch("")
      setHighlighted(selected ? `all:${selected.code}` : "")
      // Bring the current selection into view once the list has rendered.
      requestAnimationFrame(() => {
        listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "center" })
      })
    }
  }

  const select = (country: Country) => {
    onChange(country.name)
    setOpen(false)
  }

  const itemClass =
    "group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none transition-colors data-[selected=true]:bg-accent/[0.12] data-[selected=true]:text-white"

  const renderItem = (country: Country, prefix: string) => {
    const isCurrent = selected?.code === country.code
    return (
      <Command.Item
        key={`${prefix}:${country.code}`}
        value={`${prefix}:${country.code}`}
        keywords={[country.name, country.code, ...(ALIASES[country.code] || [])]}
        onSelect={() => select(country)}
        className={itemClass}
      >
        <Flag code={country.code} />
        <span className="min-w-0 flex-1 truncate">{country.name}</span>
        {isCurrent ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        ) : (
          <span className="font-mono text-[11px] text-slate-500 group-data-[selected=true]:text-slate-300">{country.code}</span>
        )}
      </Command.Item>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          className={cn(
            "group flex h-11 w-full items-center gap-3 rounded-xl border bg-white/[0.03] px-4 text-left text-base outline-none transition-all",
            "hover:border-white/20 hover:bg-white/[0.05] focus-visible:border-accent/60 focus-visible:ring-[3px] focus-visible:ring-accent/20",
            open && "border-accent/60 ring-[3px] ring-accent/20",
            invalid && !open ? "border-rose-400/70" : !open && "border-white/10",
          )}
        >
          {selected ? (
            <Flag code={selected.code} />
          ) : (
            <Globe2 className="h-4 w-4 shrink-0 text-slate-500" />
          )}
          <span className={cn("min-w-0 flex-1 truncate", value ? "text-white" : "text-slate-500")}>
            {value || "Select your country"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-slate-300" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-[var(--radix-popover-trigger-width)] min-w-[300px] overflow-hidden rounded-2xl border border-white/10 bg-[rgba(13,19,27,0.97)] p-0 shadow-[0_24px_70px_rgba(0,0,0,0.6),0_0_0_1px_rgba(87,229,234,0.06)] backdrop-blur-xl"
      >
        <Command value={highlighted} onValueChange={setHighlighted} filter={rankCountry} loop className="flex flex-col">
          <div className="flex items-center gap-3 border-b border-white/8 px-4">
            <Search className="h-4 w-4 shrink-0 text-accent" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search countries…"
              className="h-12 w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </div>

          <Command.List
            ref={listRef}
            className="max-h-[min(320px,45vh)] overflow-y-auto overscroll-contain p-2 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin]"
          >
            <Command.Empty className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Globe2 className="h-6 w-6 text-slate-600" />
              <p className="text-sm text-slate-400">No country matches &ldquo;{search}&rdquo;</p>
            </Command.Empty>

            {!search && (
              <Command.Group
                heading="Suggested"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-accent"
              >
                {suggested.map((country) => renderItem(country, "suggested"))}
              </Command.Group>
            )}

            <Command.Group
              heading={search ? undefined : "All countries"}
              className="[&_[cmdk-group-heading]]:mt-2 [&_[cmdk-group-heading]]:border-t [&_[cmdk-group-heading]]:border-white/8 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-4 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-slate-500"
            >
              {countries.map((country) => renderItem(country, "all"))}
            </Command.Group>
          </Command.List>

          <div className="hidden items-center justify-between border-t border-white/8 bg-black/20 px-4 py-2.5 text-[11px] text-slate-500 sm:flex">
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-white/15 bg-white/[0.05] px-1.5 font-sans">↑</kbd>
                <kbd className="rounded border border-white/15 bg-white/[0.05] px-1.5 font-sans">↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-white/15 bg-white/[0.05] px-1.5 font-sans">↵</kbd>
                select
              </span>
            </span>
            <span>{countries.length} countries</span>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
