export default function App(): React.JSX.Element {
  return (
    <div className="grid h-full grid-cols-[16rem_1fr_20rem] grid-rows-[1fr_14rem] bg-background text-sm">
      <aside
        aria-label="Cameras"
        className="row-span-2 flex flex-col border-r bg-sidebar text-sidebar-foreground"
      >
        <h2 className="px-4 pt-4 pb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Cameras
        </h2>
      </aside>

      <main aria-label="Map" className="flex items-center justify-center bg-muted/40">
        <div className="text-center">
          <h1 className="font-semibold text-2xl tracking-tight">Stecknadel</h1>
          <p className="mt-1 text-muted-foreground">
            Load a folder of photos and a track to see where each photo was taken.
          </p>
        </div>
      </main>

      <aside aria-label="Metadata" className="row-span-2 border-l" />

      <section aria-label="Photos" className="border-t" />
    </div>
  )
}
