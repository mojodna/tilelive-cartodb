"use strict";

var assert = require("assert"),
    path = require("path"),
    url = require("url"),
    util = require("util");

var debug = require("debug"),
    holdtime = require("holdtime"),
    request = require("request");

var meta = require("./package.json");

debug = debug(meta.name);

var makeRequest = function(method, options, callback) {
  debug("%s %s", method.toUpperCase(), options.uri);
  return request[method.toLowerCase()](options, function(err, rsp, body) {
    if (err) {
      return console.warn(err.stack);
    }

    switch (true) {
    case rsp.statusCode === 200:
      debug(rsp.statusCode, body);
      return callback(null, rsp, body);

    case rsp.statusCode >= 400 && rsp.statusCode < 500:
      debug("we did something wrong (%d):", rsp.statusCode, body);
      return callback(rsp);

    case rsp.statusCode >= 500:
      debug("CartoDB did something wrong (%d):", rsp.statusCode, body);
      return callback(rsp);

    default:
      debug("something unexpected happened (%d):", rsp.statusCode, body);
      return callback(rsp);
    }
  });
};

module.exports = function(tilelive) {
  var CartoDB = function(uri, callback) {
    if (typeof uri === "string") {
      uri = url.parse(uri, true);
    }

    var auth = (uri.auth || "").split(":", 2);

    this.username = auth.shift() || process.env.CARTODB_USERNAME || "";
    this.apiKey = auth.shift() || process.env.CARTODB_API_KEY || "";
    this.hostname = uri.hostname || process.env.CARTODB_HOSTNAME || "cartodb.com";
    this.scale = (uri.query || {}).scale || 1;

    try {
      assert(this.username, "A CartoDB username is required.");
      assert(this.apiKey, "A CartoDB API key is required.");
    } catch (err) {
      return callback(err);
    }

    switch (uri.protocol) {
    case "cartodb:":
      this.name = uri.pathname.slice(1);

      return this._getUrlTemplate(function(err, template) {
        if (err) {
          return callback(err);
        }

        return tilelive.load(template, callback);
      });

    case "cartodb+file:":
      var filename = path.resolve(path.join(uri.hostname, uri.pathname)),
          config = require(filename),
          self = this;

      // override hostname, as it would have been set to a path fragment (or
      // nothing)
      this.hostname = process.env.CARTODB_HOSTNAME || "cartodb.com";

      return self._createOrUpdate(config, function(err) {
        if (err) {
          return callback(err);
        }

        return tilelive.load(util.format("cartodb://%s:%s@%s/%s?scale=%d", self.username, self.apiKey, self.hostname, config.name, self.scale), callback);
      });

    default:
      return callback(new Error(util.format("Protocol '%s' is not valid for %s", uri.protocol, meta.name)));
    }

    return setImmediate(callback, null, this);
  };

  CartoDB.prototype._getUrlTemplate = function(callback) {
    return this._instantiate(function(err, rsp, body) {
      if (err) {
        return callback(err);
      }

      var scaleModifier = "";

      if (this.scale > 1) {
        scaleModifier = util.format("@%dx", this.scale);
      }

      return callback(null, util.format("https://%s.%s/api/v1/map/%s/{z}/{x}/{y}%s.png", this.username, this.hostname, body.layergroupid, scaleModifier));
    }.bind(this));
  };

  CartoDB.prototype._createOrUpdate = function(config, callback) {
    var self = this;

    return this._update(config, function(err, rsp, body) {
      if (err && err.statusCode === 400) {
        return self._create(config, callback);
      }

      return callback.apply(null, arguments);
    });
  };

  CartoDB.prototype._create = function(config, callback) {
    return makeRequest("post", {
      qs: {
        api_key: this.apiKey
      },
      json: config,
      uri: util.format("https://%s.%s/api/v1/map/named", this.username, this.hostname)
    }, callback);
  };

  CartoDB.prototype._update = function(config, callback) {
    return makeRequest("put", {
      qs: {
        api_key: this.apiKey
      },
      json: config,
      uri: util.format("https://%s.%s/api/v1/map/named/%s", this.username, this.hostname, config.name)
    }, callback);
  };

  CartoDB.prototype._instantiate = function(callback) {
    return makeRequest("post", {
      qs: {
        api_key: this.apiKey
      },
      json: {},
      uri: util.format("https://%s.%s/api/v1/map/named/%s", this.username, this.hostname, this.name)
    }, callback);
  };

  CartoDB.registerProtocols = function(tl) {
    tl.protocols["cartodb:"] = CartoDB;
    tl.protocols["cartodb+file:"] = CartoDB;
  };

  CartoDB.registerProtocols(tilelive);

  return CartoDB;
};
