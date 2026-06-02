import assert from 'node:assert/strict'
import http, { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { contentDispositionHeader } from './exportHeaders'

const chineseFilename = 'page-主界面.md'
const header = contentDispositionHeader('inline', chineseFilename)

assert.equal(header, 'inline; filename="page-.md"; filename*=UTF-8\'\'page-%E4%B8%BB%E7%95%8C%E9%9D%A2.md')

const response = new http.ServerResponse(new IncomingMessage(new Socket()))
assert.doesNotThrow(() => response.setHeader('Content-Disposition', header))

console.log('exportHeaders.test.ts: all assertions passed')
