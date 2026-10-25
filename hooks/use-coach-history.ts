"use client"

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react"
import { supabase } from "@/lib/supabase"
import {
  CONTEXT_MESSAGES, EARLIER_CONTEXT, contextOf, keepHere, loadSaved, markSaved, newConversation, readSyncState,
  reconcile, saveMessages, tellStartedOver, toSaved, unsaved, writeSyncState, type Api, type SavedMessage,
  type SavedThread, type SyncState, type ThreadMessage,
} from "@/lib/coach-history"

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
// How long a message waits for the saved conversation to come back before going without it (it's back long before, as
// a rule: it's asked for as the chat opens).
const READY_MS = 2500
// New messages are saved this long after their exchange, so a voice call's turns go together.
const SAVE_DELAY_MS = 400

type Threads<M> = Record<string, M[]>

/**
 * Keeps the chat's conversations on this device and the athlete's saved chats (lib/coach-history.ts) in step: as the
 * chat opens the saved conversation comes back, and each exchange is saved as it happens; `startOver` ("New chat") and
 * `clearAll` ("Clear history") start conversations over everywhere. It all happens in the background, one step at a
 * time, and nothing waits on it but a message sent while the conversation is still coming back (`ready`): while saved
 * chats can't be reached, conversations stay on this device, as they always did, and are saved later.
 */
export function useCoachHistory<M extends ThreadMessage>({ userKey, coaches, threads, threadsRef, setThreads, restore, greeting }: {
  userKey: string
  coaches: string[]
  threads: Threads<M>
  /** The chat's conversations as they are now, updated here at once when they change. */
  threadsRef: MutableRefObject<Threads<M>>
  setThreads: Dispatch<SetStateAction<Threads<M>>>
  restore: (message: SavedMessage) => M
  greeting: (coach: string) => M
}) {
  const sync = useRef<SyncState | null>(null)
  sync.current ??= readSyncState(userKey)
  // Whether the server keeps saved chats (null: not known yet).
  const available = useRef<boolean | null>(null)
  // How many messages of the conversation the backend takes with a message: what one from before took, until it says.
  const contextSize = useRef(EARLIER_CONTEXT)
  // One step at a time: getting the conversation back, telling about starting over, saving.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const started = useRef(false)
  const back = useRef<{ done: boolean; promise: Promise<void>; resolve: () => void } | null>(null)
  if (!back.current) {
    let resolve = () => {}
    const promise = new Promise<void>((done) => { resolve = done })
    back.current = { done: false, promise, resolve }
  }
  const coachesRef = useRef(coaches)
  coachesRef.current = coaches

  const state = () => sync.current as SyncState
  const remember = (next: SyncState) => {
    sync.current = next
    writeSyncState(userKey, next)
  }

  /** Changes a coach's conversation: at once for what reads it next, and in the chat. */
  const change = (coach: string, update: (thread: M[]) => M[]) => {
    const current = threadsRef.current[coach] ?? []
    const next = update(current)
    if (next === current) return
    threadsRef.current = { ...threadsRef.current, [coach]: next }
    setThreads((previous) => ({ ...previous, [coach]: update(previous[coach] ?? []) }))
  }

  /** This device's conversation with `coach` brought up to date with the saved one. */
  const adopt = (coach: string, saved: SavedThread) => {
    // Started over here meanwhile: that comes first, and the server is told before anything else.
    if (state().resets[coach] || state().everything) return
    const attached = state().conversations[coach]
    const welcome = greeting(coach)
    change(coach, (thread) => reconcile(thread, attached, saved, restore, () => welcome))
    remember({ ...state(), conversations: { ...state().conversations, [coach]: saved.conversation } })
  }

  const bearer = async () => {
    const { data } = await supabase.auth.getSession()
    return data.session ? `Bearer ${data.session.access_token}` : null
  }

  /** Tells the server about conversations started over here, before anything else is saved; false when it couldn't. */
  const tellResets = async (api: Api) => {
    const { resets, everything } = state()
    if (!Object.keys(resets).length && !everything) return true
    const told = await tellStartedOver(api, resets, everything)
    if (!told) return false
    // Only what was told is done: starting over again meanwhile is told next.
    const now = state()
    remember({ ...now, resets: Object.fromEntries(Object.entries(now.resets).filter(([coach, id]) => resets[coach] !== id)), everything: now.everything && !everything })
    if (told === "unavailable") available.current = false
    return true
  }

  /** Saves the exchanges with `coach` the server doesn't have yet. */
  const upload = async (api: Api, coach: string) => {
    // A few rounds at most: a round that finds the conversation started over elsewhere brings it up to date first.
    for (let round = 0; round < 3; round += 1) {
      const waiting = (threadsRef.current[coach] ?? []).filter(unsaved)
      if (!waiting.length) return
      // The server keeps a conversation's newest CONTEXT_MESSAGES: older ones waiting (a long time offline) stay here.
      const older = new Set(waiting.slice(0, -CONTEXT_MESSAGES).map((message) => message.id))
      if (older.size) change(coach, (thread) => keepHere(thread, older))
      const sending = waiting.slice(-CONTEXT_MESSAGES)
      let conversation = state().conversations[coach]
      if (!conversation) {
        conversation = newConversation()
        remember({ ...state(), conversations: { ...state().conversations, [coach]: conversation } })
      }
      const result = await saveMessages(api, coach, conversation, sending.map(toSaved))
      if (result === null) return // not now: they're saved next time
      if (result === "unavailable") {
        available.current = false
        return
      }
      if (result === "refused") {
        change(coach, (thread) => keepHere(thread, new Set(sending.map((message) => message.id))))
      } else if ("stale" in result) {
        if (result.stale) adopt(coach, result.stale)
        else {
          // The conversation is gone on the server: these start a new one.
          const conversations = { ...state().conversations }
          delete conversations[coach]
          remember({ ...state(), conversations })
        }
      } else {
        const saved = new Set(result.saved)
        change(coach, (thread) => markSaved(thread, saved))
        return
      }
    }
  }

  const step = (task: (api: Api) => Promise<void>) => {
    queue.current = queue.current
      .then(async () => {
        const authorization = await bearer()
        if (authorization) await task({ base: apiUrl(), authorization })
      })
      .catch((problem) => console.warn("Saved coach chats:", problem))
    return queue.current
  }

  /** Saving what's new (after telling about starting over), soon: what comes meanwhile goes with it. */
  const keeps = () => available.current !== false
  const saveNow = () => step(async (api) => {
    // Telling about starting over can find the server keeps no saved chats: then nothing is sent.
    if (!keeps() || !(await tellResets(api)) || !keeps()) return
    for (const coach of coachesRef.current) await upload(api, coach)
  })
  const saveSoon = (delay = SAVE_DELAY_MS) => {
    if (!keeps() || timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      void saveNow()
    }, delay)
  }

  // As the chat opens: the saved conversations come back, then what's new here is saved.
  useEffect(() => {
    if (started.current) return
    started.current = true
    const done = back.current!
    void step(async (api) => {
      if (!(await tellResets(api))) return
      const saved = await loadSaved(api)
      if (!saved) return
      available.current = saved.available
      contextSize.current = saved.context
      if (!saved.available) {
        // Nothing is kept on the server to start over: conversations stay here until it does.
        remember({ ...state(), resets: {}, everything: false })
        return
      }
      for (const coach of coachesRef.current) {
        const thread = saved.threads[coach]
        if (thread) adopt(coach, thread)
      }
    }).then(() => {
      // However that went (signed out, offline, no saved chats): messages stop waiting for it.
      done.done = true
      done.resolve()
      saveSoon(0)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Each exchange is saved once it's whole.
  useEffect(() => {
    if (Object.values(threads).some((thread) => thread.some(unsaved))) saveSoon()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads])

  // Closing the chat saves what's waiting at once.
  useEffect(() => () => {
    if (!timer.current) return
    clearTimeout(timer.current)
    timer.current = null
    void saveNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Resolves once the saved conversation is back (or, failing that, after a moment): a message waits for it so the
   *  coach has all of it. */
  const ready = useCallback(() => {
    const done = back.current!
    if (done.done) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, READY_MS)
      void done.promise.then(() => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }, [])

  /** The conversation as it goes to the coach with a message: as much of it as the backend takes. */
  const context = useCallback((messages: readonly ThreadMessage[]) => contextOf(messages, contextSize.current), [])

  /** "New chat": a new conversation with `coach`, everywhere. */
  const startOver = (coach: string) => {
    const conversation = newConversation()
    const now = state()
    remember({
      ...now, conversations: { ...now.conversations, [coach]: conversation },
      resets: available.current === false ? now.resets : { ...now.resets, [coach]: conversation },
    })
    saveSoon(0)
  }

  /** "Clear history": a new conversation with each coach, and every other saved chat deleted, everywhere. */
  const clearAll = (all: string[]) => {
    const conversations = Object.fromEntries(all.map((coach) => [coach, newConversation()]))
    const keeps = available.current !== false
    remember({ conversations, resets: keeps ? { ...state().resets, ...conversations } : {}, everything: keeps })
    saveSoon(0)
  }

  return { ready, context, startOver, clearAll }
}
