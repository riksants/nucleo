import { useDeferredValue, useState } from 'react'
import { isEnabled } from '../../app/modules'
import { PageHeader } from '../../app/Shell'
import { useStore } from '../../data/store'
import { SearchField } from '../../ui/Display'
import { EXAMPLES } from './catalog'
import { SearchResults, useSearchGroups } from './SearchResults'

/** Buscar (also inside the menu ☰): old links and the "/" shortcut on the computer still land here. */
export function SearchPage() {
  const { settings } = useStore()
  const [query, setQuery] = useState('')
  // Typing stays instant; the results catch up right after (useful with many records on a phone).
  const deferred = useDeferredValue(query)
  const groups = useSearchGroups(deferred)
  const first = groups[0]?.rows[0]
  const examples = EXAMPLES.filter((e) => !e.module || isEnabled(settings, e.module))

  return (
    <>
      <PageHeader title="Buscar" />
      <form
        role="search"
        className="mb-6"
        onSubmit={(e) => {
          // Enter opens the best result.
          e.preventDefault()
          first?.go()
        }}
      >
        <SearchField value={query} onChange={setQuery} placeholder="Seções, ações, clientes, valores…" autoFocus />
      </form>

      {!query.trim() && (
        <section aria-label="Sugestões">
          <p className="mb-3 px-1 text-[15px] text-soft">Procure uma seção, uma ação ou qualquer coisa que você registrou. Experimente:</p>
          <div className="flex flex-wrap gap-2">
            {examples.map((e) => (
              <button key={e.query} type="button" onClick={() => setQuery(e.query)} className="press rounded-full bg-tint/[0.05] px-4 py-2 text-[14px] font-medium text-ink ring-1 ring-line ring-inset hover:bg-tint/[0.08]">
                {e.query}
              </button>
            ))}
          </div>
        </section>
      )}

      <SearchResults query={deferred} groups={groups} />
    </>
  )
}
