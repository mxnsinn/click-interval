const arrayRemove = require('unordered-array-remove')
const defaultGateway = require('default-gateway')
const debug = require('debug')('nat-api')
const NatUPNP = require('./lib/upnp')
const NatPMP = require('./lib/pmp')

class NatAPI {
  /**
  * opts:
  *  - ttl
  *  - description
  *  - gateway
  *  - autoUpdate
  *  - enablePMP (default = false)
  **/
  constructor (opts = {}) {
    // TTL is 2 hours (min 20 min)
    this.ttl = (opts.ttl) ? Math.max(opts.ttl, 1200) : 7200
    this.description = opts.description || 'NatAPI'
    this.gateway = opts.gateway || null
    this.autoUpdate = !!opts.autoUpdate || true

    // Refresh the mapping 10 minutes before the end of its lifetime
    this._timeout = (this.ttl - 600) * 1000
    this._destroyed = false
    this._openPorts = []
    this._upnpIntervals = {}
    this._pmpIntervals = {}

    // Setup UPnP Client
    this._upnpClient = NatUPNP.createClient()

    // Setup NAT-PMP Client
    this.enablePMP = !!opts.enablePMP
    if (this.enablePMP) {
      try {
        // Lookup gateway IP
        const results = defaultGateway.v4.sync()
        this._pmpClient = NatPMP.connect(results.gateway)
      } catch (err) {
        debug('Could not find gateway IP for NAT-PMP', err)
        this._pmpClient = null
      }
    } else {
      // Not necessary - but good for readability
      this._pmpClient = null
    }
  }

  /**
  * opts:
  *  - publicPort
  *  - privatePort
  *  - protocol
  *  - description
  *  - ttl
  *  - gateway
  **/
  map (publicPort, privatePort, cbParam) {
    const self = this
    if (self._destroyed) throw new Error('client is destroyed')

    // Validate input
    const { opts, cb } = self._validateInput(publicPort, privatePort, cbParam)

    if (opts.protocol) {
      // UDP or TCP
      self._map(opts, function (err) {
        if (err) return cb(err)
        const newOpts = Object.assign({}, opts)
        rememberOpenPort(self, newOpts)
        cb()
      })
    } else {
      // UDP & TCP
      const newOptsUDP = Object.assign({}, opts)
      newOptsUDP.protocol = 'UDP'
      self._map(newOptsUDP, function (err) {
        if (err) return cb(err)

        rememberOpenPort(self, newOptsUDP)

        const newOptsTCP = Object.assign({}, opts)
        newOptsTCP.protocol = 'TCP'
        self._map(newOptsTCP, function (err) {
          if (err) return cb(err)

          rememberOpenPort(self, newOptsTCP)
          cb()
        })
      })
    }
  }

  /**
  * opts:
  *  - publicPort
  *  - privatePort
  *  - protocol
  *  - description
  *  - ttl
  *  - gateway
  **/
  unmap (publicPort, privatePort, cbParam) {
    const self = this
    if (self._destroyed) throw new Error('client is destroyed')

    // Validate input
    const { opts, cb } = self._validateInput(publicPort, privatePort, cbParam)

    if (opts.protocol) {
      // UDP or TCP
      self._unmap(opts, function (err) {
        if (err) return cb(err)
        forgetOpenPorts(self, opts)
        cb()
      })
    } else {
      // UDP & TCP
      const newOptsUDP = Object.assign({}, opts)
      newOptsUDP.protocol = 'UDP'
      self._unmap(newOptsUDP, function (err) {
        if (err) return cb(err)

        const newOptsTCP = Object.assign({}, opts)
        newOptsTCP.protocol = 'TCP'
        self._unmap(newOptsTCP, function (err) {
          if (err) return cb(err)
          forgetOpenPorts(self, opts)
          cb()
        })
      })
    }
  }

  destroy (cb) {
    const self = this
    if (self._destroyed) throw new Error('client already destroyed')

    if (!cb) cb = noop

    function continueDestroy () {
      self._destroyed = true

      // Close NAT-PMP client
      if (self._pmpClient) {
        debug('Close PMP client')
        self._pmpClient.close()
      }

      // Close UPNP Client
      if (self._upnpClient) {
        debug('Close UPnP client')
        self._upnpClient.destroy()
      }

      // Use callback for future versions
      cb()
    }

    // Unmap all ports
    const openPortsCopy = Object.assign([], self._openPorts)
    let numPorts = openPortsCopy.length
    if (numPorts === 0) return continueDestroy()

    openPortsCopy.forEach(function (openPortObj) {
      self.unmap(openPortObj, function () {
        // Ignore the errors
        numPorts--
        if (numPorts === 0) {
          continueDestroy()
        }
      })
    })
  }

  _validateInput (publicPort, privatePort, cb) {
    let opts
    if (typeof publicPort === 'object') {
      // opts
      opts = publicPort
      if (typeof privatePort === 'function') cb = privatePort
      else if (!privatePort) cb = noop
      else throw new Error('invalid parameters')
    } else if (typeof publicPort === 'number' && typeof privatePort === 'number') {
      // number, number
      opts = {}
      opts.publicPort = publicPort
      opts.privatePort = privatePort
      if (!cb) cb = noop
    } else if (typeof publicPort === 'number') {
      // number
      opts = {}
      opts.publicPort = publicPort
      opts.privatePort = publicPort
      if (typeof privatePort === 'function') cb = privatePort
      else if (!privatePort) cb = noop
      else throw new Error('invalid parameters')
    } else {
      throw new Error('port was not specified')
    }

    if (opts.protocol && (typeof opts.protocol !== 'string' || !['UDP', 'TCP'].includes(opts.protocol.toUpperCase()))) {
      throw new Error('protocol is invalid')
    } else {
      opts.protocol = opts.protocol || null
    }
    opts.description = opts.description || this.description
    opts.ttl = opts.ttl || this.ttl
    opts.gateway = opts.gateway || this.gateway

    return { opts: opts, cb: cb }
  }

  _map (opts, cb) {
    const self = this
    function tryUPNP () {
      self._upnpMap(opts, function (err) {
        if (err) {
          let newErr
          if (self._pmpClient) newErr = new Error('NAT-PMP and UPnP port mapping failed')
          else newErr = new Error('UPnP port mapping failed')
          return cb(newErr)
        }

        cb()
      })
    }

    // Try NAT-PMP
    if (this._pmpClient) {
      this._pmpMap(opts, function (err) {
        if (self._destroyed) return

        // Try UPnP
        if (err) return tryUPNP()

        cb()
      })
    } else {
      // Try UPnP
      tryUPNP()
    }
  }

  externalIp (cb) {
    const self = this
    let settled = false
    function finish (err, ip) {
      if (settled) return
      settled = true
      cb(err, ip)
    }
    function tryUPNP () {
      self._upnpClient.externalIp(function (err, ip) {
        if (err) {
          let newErr
          if (self._pmpClient) newErr = new Error('NAT-PMP and UPnP get external ip failed')
          else newErr = new Error('UPnP get external failed')
          return finish(newErr)
        }

        const normalizedIp = ip && Array.isArray(ip.ip) ? ip.ip.join('.') : ip
        finish(undefined, normalizedIp)
      })
    }

    // Try NAT-PMP
    if (this._pmpClient) {
      if (this._pmpClient.socket == null) this._pmpClient = NatPMP.connect(this._pmpClient.gateway)
      const pmpClient = this._pmpClient
      let pmpFinished = false
      const pmpTimeout = setTimeout(function () {
        if (pmpFinished || settled) return
        pmpFinished = true
        pmpClient.close()
        if (self._destroyed) return
        tryUPNP()
      }, 250)
      this._pmpClient.externalIp(function (err, ip) {
        if (pmpFinished || settled) return
        if (self._destroyed) {
          pmpFinished = true
          clearTimeout(pmpTimeout)
          pmpClient.close()
          return
        }
        pmpFinished = true
        clearTimeout(pmpTimeout)
        pmpClient.close()

        // Try UPnP
        if (err) return tryUPNP()

        const normalizedIp = ip && Array.isArray(ip.ip) ? ip.ip.join('.') : ip
        finish(undefined, normalizedIp)
      })
    } else {
      // Try UPnP
      tryUPNP()
    }
  }

  _unmap (opts, cb) {
    const self = this
    function tryUPNP () {
      self._upnpUnmap(opts, function (err) {
        if (err) {
          let newErr
          if (self._pmpClient) newErr = new Error('NAT-PMP and UPnP port mapping failed')
          else newErr = new Error('UPnP port mapping failed')
          return cb(newErr)
        }

        cb()
      })
    }

    // Try NAT-PMP
    if (this._pmpClient) {
      this._pmpUnmap(opts, function (err) {
        if (self._destroyed) return

        // Try UPnP
        if (err) return tryUPNP()

        cb()
      })
    } else {
      // Try UPnP
      tryUPNP()
    }
  }

  _upnpMap (opts, cb) {
    const self = this
    debug('Mapping public port %d to private port %d by %s using UPnP', opts.publicPort, opts.privatePort, opts.protocol)
    self._upnpClient.portMapping({
      public: opts.publicPort,
      private: opts.privatePort,
      description: opts.description,
      protocol: opts.protocol,
      ttl: opts.ttl
    }, function (err) {
      if (err) {
        debug('Error mapping port %d:%d using UPnP:', opts.publicPort, opts.privatePort, err.message)
        return cb(err)
      }

      if (self.autoUpdate) {
        const key = opts.publicPort + ':' + opts.privatePort + '-' + opts.protocol
        if (self._upnpIntervals[key]) clearInterval(self._upnpIntervals[key])
        self._upnpIntervals[key] = setInterval(
          self._upnpMap.bind(self, opts, () => {}),
          self._timeout
        )
      }

      debug('Port %d:%d for protocol %s mapped on router using UPnP', opts.publicPort, opts.privatePort, opts.protocol)

      cb()
    })
  }

  _pmpMap (opts, cb) {
    const self = this
    debug('Mapping public port %d to private port %d by %s using NAT-PMP', opts.publicPort, opts.privatePort, opts.protocol)

    // If we come from a timeouted (or error) request, we need to reconnect
    if (self._pmpClient && self._pmpClient.socket == null) {
      self._pmpClient = NatPMP.connect(self._pmpClient.gateway)
    }

    let timeouted = false
    const pmpTimeout = setTimeout(function () {
      timeouted = true
      self._pmpClient.close()
      const err = new Error('timeout')
      debug('Error mapping port %d:%d using NAT-PMP:', opts.publicPort, opts.privatePort, err.message)
      cb(err)
    }, 250)

    self._pmpClient.portMapping({
      public: opts.publicPort,
      private: opts.privatePort,
      type: opts.protocol,
      ttl: opts.ttl
    }, function (err, info) {
      if (timeouted) return
      clearTimeout(pmpTimeout)

      if (err) {
        self._pmpClient.close()
        debug('Error mapping port %d:%d using NAT-PMP:', opts.publicPort, opts.privatePort, err.message)
        return cb(err)
      }

      const mappedPublicPort = Number(info && (info.public || info.external))
      const mappedPrivatePort = Number(info && (info.private || info.internal))
      if (mappedPublicPort !== Number(opts.publicPort) || mappedPrivatePort !== Number(opts.privatePort)) {
        const mismatch = new Error(
          `NAT-PMP assigned ${mappedPublicPort || 'an unknown public port'}:${mappedPrivatePort || 'an unknown private port'} ` +
          `instead of ${opts.publicPort}:${opts.privatePort}`
        )
        mismatch.code = 'NAT_PMP_PORT_MISMATCH'
        debug('NAT-PMP mapping mismatch:', mismatch.message)
        if (mappedPublicPort > 0 && mappedPrivatePort > 0) {
          let cleanupFinished = false
          const finishMismatch = function () {
            if (cleanupFinished) return
            cleanupFinished = true
            clearTimeout(cleanupTimeout)
            self._pmpClient.close()
            cb(mismatch)
          }
          const cleanupTimeout = setTimeout(finishMismatch, 250)
          try {
            self._pmpClient.portUnmapping({
              public: mappedPublicPort,
              private: mappedPrivatePort,
              type: opts.protocol
            }, finishMismatch)
          } catch (_) {
            finishMismatch()
          }
          return
        }
        self._pmpClient.close()
        return cb(mismatch)
      }

      // Always close the short-lived NAT-PMP socket after validating the
      // exact external port assigned by the gateway.
      self._pmpClient.close()

      if (self.autoUpdate) {
        const key = opts.publicPort + ':' + opts.privatePort + '-' + opts.protocol
        if (self._pmpIntervals[key]) clearInterval(self._pmpIntervals[key])
        self._pmpIntervals[key] = setInterval(
          self._pmpMap.bind(self, opts, () => {}),
          self._timeout
        )
      }

      debug('Port %d:%d for protocol %s mapped on router using NAT-PMP', opts.publicPort, opts.privatePort, opts.protocol)

      cb()
    })
  }

  _upnpUnmap (opts, cb) {
    const self = this
    debug('Unmapping public port %d to private port %d by %s using UPnP', opts.publicPort, opts.privatePort, opts.protocol)

    // Stop renewal before asking the router to remove the mapping. If the router
    // refuses, the lease can still expire instead of being silently reopened.
    const key = opts.publicPort + ':' + opts.privatePort + '-' + opts.protocol
    if (self._upnpIntervals[key]) {
      clearInterval(self._upnpIntervals[key])
      delete self._upnpIntervals[key]
    }

    self._upnpClient.portUnmapping({
      public: opts.publicPort,
      private: opts.privatePort,
      protocol: opts.protocol
    }, function (err) {
      if (err) {
        debug('Error unmapping port %d:%d using UPnP:', opts.publicPort, opts.privatePort, err.message)
        return cb(err)
      }

      debug('Port %d:%d for protocol %s unmapped on router using UPnP', opts.publicPort, opts.privatePort, opts.protocol)

      cb()
    })
  }

  _pmpUnmap (opts, cb) {
    const self = this
    debug('Unmapping public port %d to private port %d by %s using NAT-PMP', opts.publicPort, opts.privatePort, opts.protocol)

    // Stop renewal even when the gateway cannot acknowledge removal.
    const key = opts.publicPort + ':' + opts.privatePort + '-' + opts.protocol
    if (self._pmpIntervals[key]) {
      clearInterval(self._pmpIntervals[key])
      delete self._pmpIntervals[key]
    }

    // If we come from a timeouted (or error) request, we need to reconnect
    if (self._pmpClient && self._pmpClient.socket == null) {
      self._pmpClient = NatPMP.connect(self._pmpClient.gateway)
    }

    let timeouted = false
    const pmpTimeout = setTimeout(function () {
      timeouted = true
      self._pmpClient.close()
      const err = new Error('timeout')
      debug('Error unmapping port %d:%d using NAT-PMP:', opts.publicPort, opts.privatePort, err.message)
      cb(err)
    }, 250)

    self._pmpClient.portUnmapping({
      public: opts.publicPort,
      private: opts.privatePort,
      type: opts.protocol
    }, function (err) {
      if (timeouted) return
      clearTimeout(pmpTimeout)

      // Always close socket
      self._pmpClient.close()

      if (err) {
        debug('Error unmapping port %d:%d using NAT-PMP:', opts.publicPort, opts.privatePort, err.message)
        return cb(err)
      }

      debug('Port %d:%d for protocol %s unmapped on router using NAT-PMP', opts.publicPort, opts.privatePort, opts.protocol)

      cb()
    })
  }

  _checkPort (publicPort, cb) {
    // TOOD: check port
  }
}

function noop () {}

function sameMapping (left, right, matchAnyProtocol) {
  return left.publicPort === right.publicPort &&
    left.privatePort === right.privatePort &&
    (matchAnyProtocol || left.protocol === right.protocol)
}

function rememberOpenPort (client, opts) {
  if (!client._openPorts.some(open => sameMapping(open, opts, false))) {
    client._openPorts.push(Object.assign({}, opts))
  }
}

function forgetOpenPorts (client, opts) {
  for (let index = client._openPorts.length - 1; index >= 0; index--) {
    if (sameMapping(client._openPorts[index], opts, opts.protocol == null)) {
      arrayRemove(client._openPorts, index)
    }
  }
}

module.exports = NatAPI
