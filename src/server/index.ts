#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
// Lampwright server entry point for Devvit Web.
import {createServer, getServerPort} from '@devvit/web/server'
import {onReq} from './server.ts'

const server = createServer(onReq)
server.on('error', err => console.error(`server error; ${err.stack}`))
const port = getServerPort()
server.listen(port, () => console.log(`http://localhost:${port}`))
