// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

let embedder = null

window.addEventListener('message', function (e) {
  embedder = e.source
  const data = JSON.parse(e.data)
  switch (data[0]) {
    case 'dimension-request':
      var reply = ['dimension-response', window.innerWidth, window.innerHeight]
      embedder.postMessage(JSON.stringify(reply), '*')
      break
  }
})
