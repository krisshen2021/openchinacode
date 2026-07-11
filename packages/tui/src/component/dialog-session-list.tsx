import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useSync } from "../context/sync"
import { createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import path from "path"
import { Locale } from "../util/locale"
import { useProject } from "../context/project"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useLocal } from "../context/local"
import { DialogSessionRename } from "./dialog-session-rename"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { openWorkspaceSelect, type WorkspaceSelection, warpWorkspaceSession } from "./dialog-workspace-create"
import { Spinner } from "./spinner"
import { errorMessage } from "../util/error"
import { DialogSessionDeleteFailed } from "./dialog-session-delete-failed"
import { useCommandShortcut } from "../keymap"
import { useEvent } from "../context/event"
import { createOpencodeClient, type GlobalSession, type Session } from "@opencode-ai/sdk/v2"

type SessionListFilter = { scope?: "project"; path?: string }
type SessionListScope = "project" | "all"
type SessionListItem = Session | GlobalSession

export function createDialogSessionListQuery(input: { search?: string; filter: SessionListFilter }) {
  const search = input.search?.trim()
  return {
    roots: true,
    limit: search ? 30 : 100,
    ...(search ? { search } : {}),
    ...input.filter,
  }
}

export function loadDialogSessionList<T>(input: {
  search?: string
  filter: SessionListFilter
  list: (query: ReturnType<typeof createDialogSessionListQuery>) => Promise<{ data?: T[] }>
}) {
  return input.list(createDialogSessionListQuery(input)).then(
    (result) => result.data,
    () => undefined,
  )
}

function createGlobalSessionListQuery(input: { search?: string }) {
  const search = input.search?.trim()
  return {
    roots: true,
    limit: search ? 30 : 100,
    ...(search ? { search } : {}),
  }
}

function loadGlobalSessionList(input: {
  search?: string
  list: (query: ReturnType<typeof createGlobalSessionListQuery>) => Promise<{ data?: GlobalSession[] }>
}) {
  return input.list(createGlobalSessionListQuery(input)).then(
    (result) => result.data,
    () => undefined,
  )
}

export function DialogSessionList(props?: { initialScope?: SessionListScope }) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const project = useProject()
  const { theme } = useTheme()
  const sdk = useSDK()
  const event = useEvent()
  const local = useLocal()
  const toast = useToast()
  const globalClient = createMemo(() => createOpencodeClient({ baseUrl: sdk.url, fetch: sdk.fetch }))
  const [scope, setScope] = createSignal<SessionListScope>(props?.initialScope ?? "project")
  const [toDelete, setToDelete] = createSignal<string>()
  const [deleted, setDeleted] = createSignal(new Set<string>())
  const [search, setSearch] = createDebouncedSignal("", 150)
  const deleteHint = useCommandShortcut("session.delete")
  const quickSwitch1 = useCommandShortcut("session.quick_switch.1")
  const quickSwitch9 = useCommandShortcut("session.quick_switch.9")

  const projectListFilter = () => ({ scope: "project" as const })

  const [projectBrowseResults, { refetch: refetchProjectBrowse }] = createResource(
    projectListFilter,
    (filter) => loadDialogSessionList({ filter, list: (query) => sdk.client.session.list(query) }),
  )
  const [projectSearchResults, { refetch: refetchProjectSearch }] = createResource(
    () => ({ query: search(), scope: scope(), filter: projectListFilter() }),
    (input) => {
      if (input.scope !== "project" || !input.query) return undefined
      return loadDialogSessionList({
        search: input.query,
        filter: input.filter,
        list: (query) => sdk.client.session.list(query),
      })
    },
  )
  const [globalBrowseResults, { refetch: refetchGlobalBrowse }] = createResource(
    () => scope() === "all",
    (enabled) =>
      enabled ? loadGlobalSessionList({ list: (query) => globalClient().experimental.session.list(query) }) : undefined,
  )
  const [globalSearchResults, { refetch: refetchGlobalSearch }] = createResource(
    () => ({ query: search(), scope: scope() }),
    (input) => {
      if (input.scope !== "all" || !input.query) return undefined
      return loadGlobalSessionList({
        search: input.query,
        list: (query) => globalClient().experimental.session.list(query),
      })
    },
  )

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const sessions = createMemo(() => {
    const result =
      scope() === "all"
        ? (globalSearchResults() ?? globalBrowseResults() ?? [])
        : (projectSearchResults() ?? projectBrowseResults() ?? sync.data.session)
    const synced = new Map(sync.data.session.map((session) => [session.id, session]))
    const ids = new Set(result.map((session) => session.id))
    const extraIDs = scope() === "all" ? [currentSessionID()] : [currentSessionID(), ...local.session.pinned()]
    const extra = extraIDs.flatMap((id) => {
      if (!id || ids.has(id)) return []
      const session = synced.get(id)
      if (session) ids.add(id)
      return session ? [session] : []
    })
    const query = search().trim().toLowerCase()
    return [...result.map((session) => (scope() === "project" ? (synced.get(session.id) ?? session) : session)), ...extra]
      .filter((session) => !deleted().has(session.id))
      .filter((session) => !query || session.title.toLowerCase().includes(query))
  })

  onCleanup(
    event.on("session.deleted", (event) => {
      setDeleted((current) => new Set(current).add(event.properties.info.id))
    }),
  )

  function recover(session: NonNullable<ReturnType<typeof sessions>[number]>) {
    const workspace = project.workspace.get(session.workspaceID!)
    const list = () => dialog.replace(() => <DialogSessionList />)
    const warp = async (selection: WorkspaceSelection) => {
      const workspaceID = await (async () => {
        if (selection.type === "none") return null
        if (selection.type === "existing") return selection.workspaceID
        let result
        try {
          result = await sdk.client.experimental.workspace.create({ type: selection.workspaceType, branch: null })
        } catch (err) {
          toast.show({
            title: "Failed to create workspace",
            message: errorMessage(err),
            variant: "error",
          })
          return
        }
        const workspace = result?.data
        if (!workspace) {
          toast.show({
            title: "Failed to create workspace",
            message: errorMessage(result?.error ?? "no response"),
            variant: "error",
          })
          return
        }
        await project.workspace.sync()
        return workspace.id
      })()
      if (workspaceID === undefined) return
      await warpWorkspaceSession({
        dialog,
        sdk,
        sync,
        project,
        toast,
        sourceWorkspaceID: session.workspaceID,
        workspaceID,
        sessionID: session.id,
        copyChanges: false,
        done: list,
      })
    }
    dialog.replace(() => (
      <DialogSessionDeleteFailed
        session={session.title}
        workspace={workspace?.name ?? session.workspaceID!}
        onDone={list}
        onDelete={async () => {
          const current = currentSessionID()
          const info = current ? sync.data.session.find((item) => item.id === current) : undefined
          const result = await sdk.client.experimental.workspace.remove({ id: session.workspaceID! })
          if (result.error) {
            toast.show({
              variant: "error",
              title: "Failed to delete workspace",
              message: errorMessage(result.error),
            })
            return false
          }
          await project.workspace.sync()
          await sync.session.refresh()
          await refetchProjectBrowse()
          if (search()) await refetchProjectSearch()
          if (scope() === "all") {
            await refetchGlobalBrowse()
            if (search()) await refetchGlobalSearch()
          }
          if (info?.workspaceID === session.workspaceID) {
            route.navigate({ type: "home" })
          }
          return true
        }}
        onRestore={() => {
          void openWorkspaceSelect({
            dialog,
            sdk,
            sync,
            project,
            toast,
            onSelect: (selection) => {
              void warp(selection)
            },
          })
          return false
        }}
      />
    ))
  }

  function orderByRecency(sessionsList: SessionListItem[]) {
    return sessionsList
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => x.id)
  }

  const browseOrder = createMemo(() =>
    orderByRecency(scope() === "all" ? (globalBrowseResults() ?? []) : (projectBrowseResults() ?? sync.data.session)),
  )

  const quickSwitchHint = createMemo(() => {
    const first = quickSwitch1()
    const last = quickSwitch9()
    if (!first || !last) return undefined
    return quickSwitchRange(first, last)
  })
  const quickSwitchFooterHints = createMemo(() => {
    const hint = quickSwitchHint()
    return hint && local.session.slots().length > 0 ? [{ title: "switch", label: hint }] : []
  })

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const sessionMap = new Map(
      sessions()
        .filter((x) => x.parentID === undefined)
        .map((x) => [x.id, x]),
    )

    const searchResult = scope() === "all" ? globalSearchResults() : projectSearchResults()
    const order = searchResult ? orderByRecency(sessions()) : browseOrder()
    const current = currentSessionID()
    const displayOrder = current && sessionMap.has(current) && !order.includes(current) ? [...order, current] : order

    const pinned = scope() === "project" ? local.session.pinned().filter((id) => sessionMap.has(id)) : []
    const pinnedSet = new Set(pinned)
    const slotByID = new Map<string, number>(local.session.slots().map((id, i) => [id, i + 1]))

    function buildOption(id: string, category: string) {
      const x = sessionMap.get(id)
      if (!x) return undefined
      const footer = scope() === "all" ? globalSessionFooter(x) : projectSessionFooter(x, project.data.project.mainDir)

      const isDeleting = toDelete() === x.id
      const status = sync.data.session_status?.[x.id]
      const isWorking = status?.type === "busy" || status?.type === "retry"
      const slot = slotByID.get(x.id)
      const gutter = isWorking
        ? () => <Spinner />
        : slot !== undefined
          ? () => <text fg={theme.accent}>{slot}</text>
          : undefined
      return {
        title: isDeleting ? `Press ${deleteHint()} again to confirm` : x.title,
        bg: isDeleting ? theme.error : undefined,
        value: x.id,
        category,
        footer,
        gutter,
      }
    }

    const remaining = displayOrder
      .filter((id) => !pinnedSet.has(id))
      .map((id) => {
        const x = sessionMap.get(id)
        if (!x) return undefined
        const label = new Date(x.time.updated).toDateString()
        return buildOption(id, label === today ? "Today" : label)
      })
      .filter((x) => x !== undefined)

    return [...pinned.map((id) => buildOption(id, "Pinned")).filter((x) => x !== undefined), ...remaining]
  })

  onMount(() => {
    dialog.setSize("large")
  })

  function switchScope(next: SessionListScope) {
    if (scope() === next) return
    setToDelete(undefined)
    setScope(next)
  }

  async function refreshSessionLists() {
    await sync.session.refresh()
    await refetchProjectBrowse()
    if (search()) await refetchProjectSearch()
    if (scope() === "all") {
      await refetchGlobalBrowse()
      if (search()) await refetchGlobalSearch()
    }
  }

  function selectSession(sessionID: string) {
    const session = sessions().find((item) => item.id === sessionID)
    if (scope() === "all" && session && session.projectID !== project.data.project.id) {
      dialog.replace(() => <DialogCrossProjectSession session={session} />)
      return
    }
    route.navigate({
      type: "session",
      sessionID,
    })
    dialog.clear()
  }

  return (
    <DialogSelect
      title={`Sessions · ${scope() === "all" ? "All Projects" : "Current Project"}`}
      options={options()}
      skipFilter={true}
      preserveSelection={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        selectSession(option.value)
      }}
      actions={[
        {
          command: "session.pin.toggle",
          title: "pin/unpin",
          hidden: scope() === "all",
          onTrigger: (option: { value: string }) => {
            local.session.togglePin(option.value)
          },
        },
        {
          command: "session.delete",
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              const session = sessions().find((item) => item.id === option.value)
              const status = session?.workspaceID ? project.workspace.status(session.workspaceID) : undefined

              try {
                const result = await sdk.client.session.delete({
                  sessionID: option.value,
                })
                if (result.error) {
                  if (session?.workspaceID) {
                    recover(session)
                  } else {
                    toast.show({
                      variant: "error",
                      title: "Failed to delete session",
                      message: errorMessage(result.error),
                    })
                  }
                  setToDelete(undefined)
                  return
                }
              } catch (err) {
                if (session?.workspaceID) {
                  recover(session)
                } else {
                  toast.show({
                    variant: "error",
                    title: "Failed to delete session",
                    message: errorMessage(err),
                  })
                }
                setToDelete(undefined)
                return
              }
              if (status && status !== "connected") {
                await sync.session.refresh()
              }
              await refreshSessionLists()
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          command: "session.rename",
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
      ]}
      footerHints={[
        { title: "scope", label: "←/→" },
        ...quickSwitchFooterHints(),
      ]}
      bindings={[
        {
          key: "left",
          desc: "Show current project sessions",
          group: "Dialog",
          cmd: () => switchScope("project"),
        },
        {
          key: "right",
          desc: "Show all project sessions",
          group: "Dialog",
          cmd: () => switchScope("all"),
        },
      ]}
    />
  )
}

function quickSwitchRange(first: string, last: string) {
  const prefix = first.slice(0, -1)
  if (first.endsWith("1") && last === `${prefix}9`) return `${prefix}1-9`
  return `${first} through ${last}`
}

function DialogCrossProjectSession(props: { session: SessionListItem }) {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const sync = useSync()
  const project = useProject()
  const toast = useToast()

  async function forkIntoCurrentDirectory() {
    const directory = project.instance.directory() || sdk.directory
    if (!directory) {
      toast.show({
        title: "Unable to fork session",
        message: "Current directory is unknown.",
        variant: "error",
      })
      return
    }
    try {
      const forked = await sdk.client.session.fork({ sessionID: props.session.id }, { throwOnError: true })
      const sessionID = forked.data?.id
      if (!sessionID) throw new Error("No forked session returned")
      await sdk.client.experimental.controlPlane.moveSession(
        {
          sessionID,
          destination: { directory },
          moveChanges: false,
        },
        { throwOnError: true },
      )
      await sdk.client.session
        .promptAsync({
          sessionID,
          directory,
          noReply: true,
          parts: [
            {
              type: "text",
              text: currentDirectoryReminderText(directory),
              synthetic: true,
            },
          ],
        })
        .catch(() => undefined)
      await sync.session.sync(sessionID).catch(() => undefined)
      route.navigate({ type: "session", sessionID })
      dialog.clear()
    } catch (error) {
      toast.show({
        title: "Failed to fork session",
        message: errorMessage(error),
        variant: "error",
      })
    }
  }

  return (
    <DialogSelect
      title="Open Session"
      options={[
        {
          title: "Open original project",
          value: "original",
          description: `Continue in ${sessionProjectLabel(props.session)}.`,
        },
        {
          title: "Use current directory",
          value: "current",
          description: "Fork this session into the current directory and leave the original unchanged.",
          footer: path.basename(project.instance.directory() || sdk.directory || ""),
        },
        {
          title: "Cancel",
          value: "cancel",
        },
      ]}
      onSelect={(option) => {
        if (option.value === "original") {
          route.navigate({ type: "session", sessionID: props.session.id })
          dialog.clear()
          return
        }
        if (option.value === "current") {
          void forkIntoCurrentDirectory()
          return
        }
        dialog.replace(() => <DialogSessionList initialScope="all" />)
      }}
    />
  )
}

function projectSessionFooter(session: SessionListItem, mainDir?: string) {
  const directory = session.path
    ? session.directory.endsWith(session.path)
      ? session.directory.slice(0, -session.path.length).replace(/\/$/, "")
      : undefined
    : session.directory
  return directory && directory !== mainDir ? Locale.truncate(path.basename(directory), 20) : ""
}

function globalSessionFooter(session: SessionListItem) {
  const project = "project" in session ? session.project : null
  const label = project?.name ?? (project?.worktree ? path.basename(project.worktree) : path.basename(session.directory))
  const suffix = session.path ? `/${session.path}` : ""
  return Locale.truncate(`${label}${suffix}`, 36)
}

function sessionProjectLabel(session: SessionListItem) {
  const project = "project" in session ? session.project : null
  return project?.name ?? project?.worktree ?? session.directory
}

function currentDirectoryReminderText(directory: string) {
  return `<system-reminder>This session was forked into the current working directory "${directory}". The earlier conversation may mention files from the original project. Treat "${directory}" as the active project root for all new file reads, edits, tests, and shell commands.</system-reminder>`
}
