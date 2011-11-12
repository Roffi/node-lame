
/**
 * `Encoder` Stream class.
 * Encodes raw PCM data into a MP3 file.
 */

var bindings = require('./bindings')
  , inherits = require('util').inherits
  , Config = require('./config').Config


/**
 * Creates a new Encoder instance.
 */

function createEncoder (opts) {
  return new Encoder(opts);
}
exports.createEncoder = exports.createEncoderStream = createEncoder;


/**
 * `Encoder` class is a readable and writable Stream class.
 * Write raw PCM data, out comes an MP3 file.
 * A lot of this logic is reused from the zlib module.
 */

function Encoder (opts) {
  Config.call(this);

  // disable the bit reservoir
  this.bitReservoir = false;
}
inherits(Encoder, Config);
exports.Encoder = Encoder;

Encoder.prototype.write = function write (chunk, cb) {
  //console.error('Encoder#write');
  if (this._ended) {
    return this.emit('error', new Error('Cannot write after end'));
  }
  if (!this._init) this._initParams();
  // TODO: Better arg checking here

  var empty = this._queue.length === 0;

  this._queue.push([chunk, cb]);
  this._process();
  if (!empty) {
    this._needDrain = true;
  }
  return empty;
}

/*  var l = b.length
    , num = ~~(l/this.BLOCK_ALIGN)
    , chunk = b.slice(0, num * this.BLOCK_ALIGN)
    , outbuf = new Buffer(1.25 * num)

  if (chunk.length != l) {
    this._backlog.push(b.slice(chunk.length));
    console.error('pushing to backlog: %d bytes', this._backlog[this._backlog.length-1].length)
  }

  //console.error('beginning to encode %d bytes, %d samples', chunk.length, num);
  var b = bindings.lame_encode_buffer_interleaved(this._gfp, chunk, num, outbuf)
  //console.error('encoded %d bytes', b);

  this.emit('data', outbuf.slice(0, b));
  return true;
}*/

// flush the remaining
Encoder.prototype.end = function end (chunk, cb) {
  //console.error('Encoder#end');
  var self = this;
  this._ending = true;
  var ret = this.write(chunk, function () {
    self.emit('end');
    if (cb) cb();
  });
  this._ended = true;
  return ret;
  /*var buf = new Buffer(9200);
  var b = bindings.lame_encode_flush_nogap(this._gfp, buf);
  this.emit('data', buf.slice(0, b));
  this.emit('end');*/
}

Encoder.prototype._process = function _process () {
  //console.error('Encoder#process()')
  if (this._processing || this._paused) return;

  if (this._queue.length === 0) {
    if (this._needDrain) {
      this._needDrain = false;
      this.emit('drain');
    }
    // nothing to do, waiting for more data at this point.
    return;
  }

  var req = this._queue.shift()
    , cb = req.pop()
    , chunk = req.pop()
    , num = chunk.length / this.BLOCK_ALIGN
    , self = this
    , availOutBefore = this._chunkSize - this._offset;

  console.error('invoke async encode:', chunk.length, num, this._offset, availOutBefore)
  bindings.lame_encode_buffer_interleaved(this._gfp // gfp
                                        , chunk     // pcm data
                                        , num       // # / samples / channel
                                        , this._buffer // out buffer
                                        , this._offset
                                        , availOutBefore
                                        , afterWrite);
  this._processing = true;

  function afterWrite (bytesWritten) {
    console.error('afterWrite:', bytesWritten)
    if (bytesWritten === -1) {
      // out buffer too small!!!
      return self.emit('error', new Error('output buffer too small!'));
    } else if (bytesWritten === -2) {
      return self.emit('error', new Error('malloc() problems'));
    } else if (bytesWritten === -3) {
      return self.emit('error', new Error('lame_init_params() not called'));
    } else if (bytesWritten === -4) {
      return self.emit('error', new Error('phycho acoustic problems'));
    } else {
      var out = self._buffer.slice(self._offset, self._offset + bytesWritten);
      self._offset += bytesWritten;
      self.emit('data', out);
    }

    // finished with this chunk
    self._processing = false;
    if (cb) cb();
    self._process();
  }
}