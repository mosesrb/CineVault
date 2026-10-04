import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'

const native = vi.hoisted(() => ({ enabled: true, listeners: [], downloads: [] }))
const fs = vi.hoisted(() => ({
  requestPermissions: vi.fn(), addListener: vi.fn(), downloadFile: vi.fn(),
  deleteFile: vi.fn(), stat: vi.fn(), getUri: vi.fn(), readFile: vi.fn(),
}))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: fs, Directory: { Data: 'DATA' } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.enabled } }))

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function load(records = []) {
  const db = await openDB('cinevault-offline', 2, {
    upgrade(db) {
      db.createObjectStore('downloads', { keyPath: 'id' })
      db.createObjectStore('api_cache', { keyPath: 'url' })
      db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true })
    },
  })
  for (const record of records) await db.put('downloads', record)
  const { OfflineStorageService: service } = await import('./OfflineStorageService')
  await service.getAllDownloads()
  return { db, service }
}
const metadata = { title: 'Synthetic lifecycle fixture' }
const start = (service, id = 'abc') => service.downloadMedia(id, '/stream/synthetic', 'movie', metadata)
async function waitForDownload(count = 1) {
  await vi.waitFor(() => expect(native.downloads).toHaveLength(count))
}
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('indexedDB', new IDBFactory())
  native.enabled = true
  native.listeners = []
  native.downloads = []
  localStorage.clear()
  fs.requestPermissions.mockResolvedValue({ publicStorage: 'granted' })
  fs.deleteFile.mockResolvedValue(undefined)
  fs.stat.mockResolvedValue({ size: 10 })
  fs.addListener.mockImplementation(async (event, handler) => {
    const listener = { event, handler, remove: vi.fn().mockResolvedValue(undefined) }
    native.listeners.push(listener)
    return listener
  })
  fs.downloadFile.mockImplementation(options => {
    const task = { ...deferred(), options }
    native.downloads.push(task)
    return task.promise
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('download task lifecycle', () => {
  it('makes interrupted startup records retryable, never completed from progress alone', async () => {
    const { service } = await load([{ id: 'abc', status: 'pending', progress: 100, path: null }])
    expect(service.isDownloading()).toBe(false)
    expect(await service.getAllDownloads()).toEqual([])
    expect((await service.getDownloadRecord('abc')).status).toBe('interrupted')
  })
  it('reserves the single-download slot before async permission work, including same ID', async () => {
    const { service } = await load()
    const permission = deferred()
    vi.spyOn(service, 'requestPermissions').mockReturnValue(permission.promise)
    const first = start(service)
    expect(service.isDownloading('abc')).toBe(true)
    await expect(start(service)).rejects.toThrow(/already in progress/)
    permission.resolve(true)
    await waitForDownload()
    native.downloads[0].resolve({})
    await first
    expect(service.isDownloading()).toBe(false)
  })
  it('persists the attributable pending filename before native work and caps progress until commit', async () => {
    const { service } = await load()
    const progress = vi.fn()
    service.subscribe('abc', progress)
    const job = start(service)
    await waitForDownload()
    const record = await service.getDownloadRecord('abc')
    expect(record.path).toBe(native.downloads[0].options.path)
    expect(record.taskId).toEqual(expect.any(String))
    native.listeners[0].handler({ url: native.downloads[0].options.url, bytes: 100, contentLength: 100 })
    expect(progress).toHaveBeenLastCalledWith(99)
    native.downloads[0].resolve({})
    await job
    expect(progress).toHaveBeenLastCalledWith(100)
  })
  it('blocks same-ID retry until retired cleanup, without letting it unlock another item', async () => {
    const { service } = await load()
    const oldJob = start(service)
    await waitForDownload()
    const oldPath = native.downloads[0].options.path
    await service.cancelDownload('abc')
    await expect(start(service)).rejects.toThrow(/still finishing/)
    const newJob = start(service, 'other')
    await waitForDownload(2)
    const newPath = native.downloads[1].options.path
    expect(newPath).not.toBe(oldPath)
    native.downloads[0].resolve({})
    expect(await oldJob).toBeNull()
    expect(service.isDownloading('other')).toBe(true)
    expect((await service.getDownloadRecord('other')).path).toBe(newPath)
    expect((await service.getDownloadRecord('abc')).status).toBe('interrupted')
    expect(native.listeners[2].remove).not.toHaveBeenCalled()
    expect(fs.deleteFile).toHaveBeenCalledWith({ path: oldPath, directory: 'DATA' })
    native.downloads[1].resolve({})
    expect(await newJob).toBe(newPath)
    expect((await service.getDownloadRecord('other')).status).toBe('completed')
  })
  it('permits a same-ID retry after cancelled rejection and cleanup settle', async () => {
    const { service } = await load()
    const oldJob = start(service)
    await waitForDownload()
    await service.cancelDownload('abc')
    await expect(start(service)).rejects.toThrow(/still finishing/)
    native.downloads[0].reject(new Error('synthetic interrupted network'))
    expect(await oldJob).toBeNull()
    const newJob = start(service)
    await waitForDownload(2)
    expect((await service.getDownloadRecord('abc')).status).toBe('pending')
    expect(service.isDownloading()).toBe(true)
    native.downloads[1].resolve({})
    await newJob
  })
  it('does not create a fake completed browser download or retain a lock', async () => {
    native.enabled = false
    const { service } = await load()
    await expect(start(service)).rejects.toThrow(/Android/)
    expect(await service.getDownloadRecord('abc')).toBeUndefined()
    expect(service.isDownloading()).toBe(false)
  })
  it('preserves completed records and rejects deleting unowned paths', async () => {
    const original = { id: 'abc', status: 'completed', path: '../private.mp4' }
    const { service } = await load([original])
    await expect(service.deleteDownload('abc')).rejects.toThrow(/manual recovery/)
    expect(fs.deleteFile).not.toHaveBeenCalled()
    expect(await service.getDownloadRecord('abc')).toEqual(original)
  })
  it('retains the record on storage deletion failure but accepts confirmed absence', async () => {
    const original = { id: 'abc', type: 'movie', status: 'completed', path: 'movie_abc_123.mp4' }
    const { service } = await load([original])
    fs.deleteFile.mockRejectedValue(new Error('synthetic storage failure'))
    await expect(service.deleteDownload('abc')).rejects.toThrow(/Unable to remove/)
    expect(await service.getDownloadRecord('abc')).toEqual(original)
    fs.stat.mockRejectedValue({ code: 'OS-PLUG-FILE-0008' })
    await service.deleteDownload('abc')
    expect(await service.getDownloadRecord('abc')).toBeUndefined()
  })
  it('cleans a known interrupted path before retry and preserves it if cleanup fails', async () => {
    const original = { id: 'abc', type: 'movie', status: 'pending', progress: 40, path: 'movie_abc_123.mp4' }
    const { service } = await load([original])
    fs.deleteFile.mockRejectedValueOnce(new Error('synthetic storage failure'))
    await expect(start(service)).rejects.toThrow(/Download failed/)
    expect((await service.getDownloadRecord('abc')).path).toBe(original.path)
    expect(service.isDownloading()).toBe(false)
    expect(fs.downloadFile).not.toHaveBeenCalled()
    const job = start(service)
    await waitForDownload()
    expect(fs.deleteFile).toHaveBeenCalledWith({ path: original.path, directory: 'DATA' })
    native.downloads[0].resolve({})
    await job
  })
  it('releases permission denial without native work or a fake record', async () => {
    const { service } = await load()
    vi.spyOn(service, 'requestPermissions').mockResolvedValue(false)
    await expect(start(service)).rejects.toThrow(/Download failed/)
    expect(service.isDownloading()).toBe(false)
    expect(fs.downloadFile).not.toHaveBeenCalled()
    expect(await service.getDownloadRecord('abc')).toBeUndefined()
  })
  it('cleans failed native partial files and keeps their registry retryable', async () => {
    const { service } = await load()
    const job = start(service)
    await waitForDownload()
    const failed = expect(job).rejects.toThrow(/Download failed/)
    native.downloads[0].reject(new Error('synthetic network failure'))
    await failed
    expect((await service.getDownloadRecord('abc')).status).toBe('interrupted')
    expect(fs.deleteFile).toHaveBeenCalledWith({ path: native.downloads[0].options.path, directory: 'DATA' })
    expect(service.isDownloading()).toBe(false)
    expect(native.listeners.every(handle => handle.remove.mock.calls.length === 1)).toBe(true)
  })
  it('removes a listener that resolves after cancellation without starting native work', async () => {
    const { service } = await load()
    const late = deferred()
    fs.addListener.mockReturnValueOnce(late.promise)
    const job = start(service)
    await vi.waitFor(() => expect(fs.addListener).toHaveBeenCalledOnce())
    await service.cancelDownload('abc')
    const handle = { remove: vi.fn().mockResolvedValue(undefined) }
    late.resolve(handle)
    expect(await job).toBeNull()
    expect(handle.remove).toHaveBeenCalledOnce()
    expect(fs.downloadFile).not.toHaveBeenCalled()
    expect(service.isDownloading()).toBe(false)
  })
  it('never deletes another item filename even when its shape is valid', async () => {
    const original = { id: 'abc', type: 'movie', status: 'completed', path: 'movie_other_123.mp4' }
    const { service } = await load([original])
    await expect(service.deleteDownload('abc')).rejects.toThrow(/manual recovery/)
    expect(fs.deleteFile).not.toHaveBeenCalled()
    expect(await service.getDownloadRecord('abc')).toEqual(original)
  })
  it('keeps the retired filename attributable after cleanup failure, until a guarded retry', async () => {
    const { service } = await load()
    const job = start(service)
    await waitForDownload()
    const path = native.downloads[0].options.path
    await service.cancelDownload('abc')
    await expect(start(service)).rejects.toThrow(/still finishing/)
    fs.deleteFile.mockRejectedValueOnce(new Error('synthetic cleanup failure'))
    native.downloads[0].resolve({})
    expect(await job).toBeNull()
    expect((await service.getDownloadRecord('abc')).path).toBe(path)
    expect((await service.getDownloadRecord('abc')).status).toBe('interrupted')
    const retry = start(service)
    await waitForDownload(2)
    expect(fs.deleteFile).toHaveBeenLastCalledWith({ path, directory: 'DATA' })
    native.downloads[1].resolve({})
    await retry
  })
  it('returns null if cancellation arrives during successful listener cleanup', async () => {
    const { service } = await load()
    const job = start(service)
    await waitForDownload()
    const removing = deferred()
    native.listeners[0].remove.mockReturnValue(removing.promise)
    native.downloads[0].resolve({})
    await vi.waitFor(() => expect(native.listeners[0].remove).toHaveBeenCalledOnce())
    await service.cancelDownload('abc')
    removing.resolve()
    expect(await job).toBeNull()
    expect((await service.getDownloadRecord('abc')).status).toBe('interrupted')
    expect(fs.deleteFile).toHaveBeenCalledWith({ path: native.downloads[0].options.path, directory: 'DATA' })
  })
  it('serializes deletion against a new download before native file removal', async () => {
    const { service } = await load([{ id: 'abc', type: 'movie', status: 'completed', path: 'movie_abc_123.mp4' }])
    const deletion = deferred()
    fs.deleteFile.mockReturnValueOnce(deletion.promise)
    const job = service.deleteDownload('abc')
    await vi.waitFor(() => expect(fs.deleteFile).toHaveBeenCalledOnce())
    await expect(start(service)).rejects.toThrow(/already in progress/)
    deletion.resolve()
    await job
    expect(await service.getDownloadRecord('abc')).toBeUndefined()
  })
})
