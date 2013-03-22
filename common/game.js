(function(exports) {
/**
 * The game instance that's shared across all clients and the server
 */
var Game = function() {
  this.state = {};
  this.oldState = {};

  // Last used ID
  this.lastId = 0;
  this.callbacks = {};

  // Counter for the number of updates
  this.updateCount = 0;
  // Timer for the update loop.
  this.timer = null;
};

Game.UPDATE_INTERVAL = Math.round(1000 / 30);
Game.MAX_DELTA = 10000;
Game.WIDTH = 640;
Game.HEIGHT = 960;
Game.SHOT_AREA_RATIO = 0.02;
Game.SHOT_SPEED_RATIO = 1;
Game.PLAYER_SPEED_RATIO = 0.1;
Game.TRANSFER_RATE = 0.05;
Game.TARGET_LATENCY = 1000; // Maximum latency skew.
Game.RESTART_DELAY = 1000;

/**
 * Computes the game state
 * @param {number} delta Number of milliseconds in the future
 * @return {object} The new game state at that timestamp
 */
Game.prototype.computeState = function(delta) {
  var newState = {
    objects: {},
    timeStamp: this.state.timeStamp + delta
  };
  var newObjects = newState.objects;
  var objects = this.state.objects;
  // Generate a new state based on the old one
  for (var objId in objects) {
    var obj = objects[objId];
    if (!obj.dead) {
      newObjects[obj.id] = obj.computeState(delta);
    }
  }

  // Largest object.
  var largest = null;
  // Total area.
  var total = 0;

  // Go through the new state and check for collisions etc, make
  // adjustments accordingly.
  for (var i in newObjects) {
    var o = newObjects[i];

    var paddle = null;
    if (o.type == "player") {
      paddle = o;
    }
    for (var j in newObjects) {
      var p = newObjects[j];
      
      var ball = null;
      if (p.type == "blob") {
        ball = p;

        if (paddle != null && ball != null) {
          if (ball.intersectsPaddle(paddle)) {
            this.bounce_(ball, paddle);
          }
        }
      }
    }

    // At this point, o is not collided with any objects.
    // But it may be out of bounds. Have it go back in-bound and
    // bounce off.
    if (!this.xInBounds_(o)) {
      // Do some math, bounce and reposition.
      this.repositionXInBounds_(o);
    }
  }

  for (var i in newObjects) {
    if (!this.yInBounds_(newObjects[i])) {
      var winId = this.paddleFarthestFromBall(newObjects[i], newObjects);
      console.log('game over!');
      this.callback_('victory', {id: winId});
    }
  }

  return newState;
};

/**
 * Computes the game state for a given timestamp in the future
 * @param {number} timeStamp Timestamp to compute for
 */
Game.prototype.update = function(timeStamp) {
  var delta = timeStamp - this.state.timeStamp;
  if (delta < 0) {
    throw "Can't compute state in the past. Delta: " + delta;
  }
  if (delta > Game.MAX_DELTA) {
    throw "Can't compute state so far in the future. Delta: " + delta;
  }
  this.state = this.computeState(delta);
  this.updateCount++;
};

/**
 * Set up an accurate timer in JS
 */
Game.prototype.updateEvery = function(interval, skew) {
  if (!skew) {
    skew = 0;
  }
  var lastUpdate = (new Date()).valueOf() - skew;
  var ctx = this;
  this.timer = setInterval(function() {
    var date = (new Date()).valueOf() - skew;
    if (date - lastUpdate >= interval) {
      ctx.update(date);
      lastUpdate += interval;
    }
  }, 1);
};

Game.prototype.over = function() {
  clearInterval(this.timer);
};

/**
 * Called when a new player joins
 */
Game.prototype.join = function(id) {
  var x, y, vx, vy;
  var numPlayers = this.getPlayerCount();
  switch (numPlayers % 2) {
    case 0:
      x = Game.WIDTH/2; y = 25; vx = 0; vy = 0;
      break;
    case 1:
      x = Game.WIDTH/2; y = Game.HEIGHT - 25 - 25; vx = 0; vy = 0;
      break;
    // case 2:
    //   x = 0; y = 480; vx = 0.1; vy = -0.1;
    //   break;
    // case 3:
    //   x = 640; y = 480; vx = -0.1; vy = -0.1;
    //   break;
  }
  // Add the player to the world
  var player = new Player({
    id: id,
    x: x,
    y: y,
    vx: vx,
    vy: vy,
    r: 20,
    targetX: 0,
    rectW: 100
  });
  this.state.objects[player.id] = player;

  //If this was the second player, start the ball
  if (numPlayers == 1) {
      this.startBalls();
  } 
  return player.id;
};

/**
 * Called when a player leaves
 */
Game.prototype.leave = function(playerId) {
  delete this.state.objects[playerId];
};

/**
 * Called when a player shoots
 * @param {object} info {id, direction, timeStamp}
 */
Game.prototype.shoot = function(id, direction, timeStamp) {
  console.log('adding shot from', this.state.timeStamp - timeStamp, 'ago');
  var player = this.state.objects[id];
  // Unit vectors.
  var ex = Math.cos(direction);
  var ey = Math.sin(direction);
  // See how much area we will need to transfer.
  var diff = player.area() * Game.SHOT_AREA_RATIO;
  // Create the new blob.
  var blob = new Blob({
    id: this.newId_(),
    vx: player.vx + ex * Game.SHOT_SPEED_RATIO,
    vy: player.vy + ey * Game.SHOT_SPEED_RATIO,
    r: 0
  });
  this.state.objects[blob.id] = blob;
  // New blob should be positioned so that it doesn't overlap parent.
  blob.x = player.x + (player.r + blob.r) * ex;
  blob.y = player.y + (player.r + blob.r) * ey;
  // Affect the player's velocity, depending on angle, speed and size.
  player.vx -= ex * Game.PLAYER_SPEED_RATIO;
  player.vy -= ey * Game.PLAYER_SPEED_RATIO;
  // Affect blob and player radius.
  blob.transferArea(diff);
  player.transferArea(-diff);
  // Check if we've suicided
  if (player.r <= 2) {
    player.dead = true;
    this.callback_('dead', {id: player.id, type: player.type});
  }
};

/**
 * Called when a player moves
 */
Game.prototype.move = function (id, mouseX, playerX) {
  var player = this.state.objects[id];

  player.x = mouseX - 50;
  if (!this.xInBounds_(player)) {
    // Reposition paddle in bounds
    this.repositionXInBounds_(player);
  }
};

Game.prototype.getPlayerCount = function() {
  var count = 0;
  var objects = this.state.objects;
  for (var id in objects) {
    if (objects[id].type == 'player') {
      count++;
    }
  }
  return count;
};

Game.prototype.paddleFarthestFromBall = function(ball, objects) {
  var paddle1;
  var paddle2;
  var paddleCount = 0;

  // Get both paddles
  for (var i in objects) {
    if (paddleCount == 2) {
      break;
    } else if (objects[i].type == "player") {
      if (paddle1) {
        paddle2 = objects[i];
      } else {
        paddle1 = objects[i];
      }
      paddleCount += 1;
    }
  }

  // It's possible for there to only be one paddle (e.g. if one player leaves),
  // so handle that
  if (paddle1 == null && paddle2 == null) {
    return 0;
  } else if (paddle1 == null) {
    return paddle2.id;
  } else if (paddle2 == null) {
    return paddle1.id;
  }

  // Get the id of the paddle that's farthest from the ball
  var farthestId;
  if (Math.abs(ball.y - paddle1.y) > Math.abs(ball.y - paddle2.y)) {
    farthestId = paddle1.id;
  } else {
    farthestId = paddle2.id;
  }

  return farthestId;
};

/***********************************************
 * Loading and saving
 */

/**
 * Save the game state.
 * @return {object} JSON of the game state
 */
Game.prototype.save = function() {
  var serialized = {
    objects: {},
    timeStamp: this.state.timeStamp
  };
  for (var id in this.state.objects) {
    var obj = this.state.objects[id];
    // Serialize to JSON!
    serialized.objects[id] = obj.toJSON();
  }

  return serialized;
};

/**
 * Load the game state.
 * @param {object} gameState JSON of the game state
 */
Game.prototype.load = function(savedState) {
  //console.log(savedState.objects);
  var objects = savedState.objects;
  this.state = {
    objects: {},
    timeStamp: savedState.timeStamp.valueOf()
  }
  for (var id in objects) {
    var obj = objects[id];
    // Depending on type, instantiate.
    if (obj.type == 'blob') {
      this.state.objects[obj.id] = new Blob(obj);
    } else if (obj.type == 'player') {
      this.state.objects[obj.id] = new Player(obj);
    }
    // Increment this.lastId
    if (obj.id > this.lastId) {
      this.lastId = obj.id;
    }
  }
};

Game.prototype.blobExists = function(blobId) {
  return this.state.objects[blobId] !== undefined;
};

/***********************************************
 * Helper functions
 */

/**
 * Transfers mass between two objects.
 */
Game.prototype.transferAreas_ = function(o, p, delta) {
  //console.log('deadness', o.id, o.dead, p.id, p.dead);
  if (o.dead || p.dead) {
    return;
  }

  var big = o;
  var small = p;

  if (big.r < small.r) {
    big = p;
    small = o;
  }
  var overlap = big.overlap(small);

  //console.log('overlapping', o.id, p.id, 'by', overlap);
  var diff = overlap * Game.TRANSFER_RATE;
  small.transferArea(-diff);
  big.transferArea(diff);

  // Check if we've killed the shrinking cell
  if (small.r <= 1) {
    small.dead = true;
    this.callback_('dead', {id: small.id, type: small.type});
  }

  //console.log('sanity check: total area', small.r + big.r);
};


/**
 * Makes the ball bounce off of the paddle.
 */
Game.prototype.bounce_ = function(ball, paddle) {
  //TODO more advanced bouncing depending on paddle position
  ball.vy = -ball.vy;

  if (paddle.y == 25) {
    ball.y = paddle.y + 25 + ball.r;
  } else {
    ball.y = paddle.y - ball.r;
  }
};

/**
 *
 */
Game.prototype.inBounds_ = function(o) {
  // For now, use a rectangular field.
  return o.r < o.x && o.x < (Game.WIDTH - o.r) &&
         o.r < o.y && o.y < (Game.HEIGHT - o.r);
};

Game.prototype.xInBounds_ = function(o) {
  // For now, use a rectangular field.
  if (o.type == "player") {
    return 0 < o.x && o.x < (Game.WIDTH - o.rectW);
  } else {
    return o.r < o.x && o.x < (Game.WIDTH - o.r);
  }
};

Game.prototype.yInBounds_ = function(o) {
  // For now, use a rectangular field.
  return o.r < o.y && o.y < (Game.HEIGHT - o.r);
};


/**
 *
 */
Game.prototype.repositionInBounds_ = function(o) {
  var maxWidth = Game.WIDTH - o.r;
  var maxHeight = Game.HEIGHT - o.r;
  if (o.x < o.r) {
    o.x = o.r;
    o.vx = -o.vx;
  } else if (o.y < o.r) {
    o.y = o.r;
    o.vy = -o.vy;
  } else if (o.x > maxWidth) {
    o.x = maxWidth;
    o.vx = -o.vx;
  } else if (o.y > maxHeight) {
    o.y = maxHeight;
    o.vy = -o.vy;
  }
};

/**
 *
 */
Game.prototype.repositionXInBounds_ = function(o) {
  if (o.type == "player") {
    var maxWidth = Game.WIDTH - o.rectW;
    if (o.x < 0) {
      o.x = 0;
      o.vx = 0;
    } else if (o.x > maxWidth) {
      o.x = maxWidth;
      o.vx = 0;
    }
  } else {
    var maxWidth = Game.WIDTH - o.r;
    if (o.x < o.r) {
      o.x = o.r;
      o.vx = -o.vx;
    } else if (o.x > maxWidth) {
      o.x = maxWidth;
      o.vx = -o.vx;
    }
  }
};

/**
 *
 */
Game.prototype.callback_ = function(event, data) {
  var callback = this.callbacks[event];
  if (callback) {
    callback(data);
  } else {
    throw "Warning: No callback defined!";
  }
};

/**
 * Deterministically generate new ID for an object
 */
Game.prototype.newId_ = function() {
  return ++this.lastId;
};

/**
 *
 */
Game.prototype.on = function(event, callback) {
  // Sample usage in a client:
  //
  // game.on('dead', function(data) {
  //   if (data.id == player.id) {
  //     // Darn -- player died!
  //   }
  // });
  this.callbacks[event] = callback;
};

/**
 * Instance of a blob in the world
 */
var Blob = function(params) {
  if (!params) {
    return;
  }
  this.id = params.id;
  this.x = params.x;
  this.y = params.y;
  this.r = params.r;
  this.vx = params.vx;
  this.vy = params.vy;
  this.targetX = params.targetX;
  this.rectW = params.rectW;
  if (!this.type) {
    this.type = 'blob';
  }
};


/**
 * Gives the amount of overlap between blobs (assuming blob and this are
 * overlapping, and that blob < this.
 * @returns {number} Amount of overlap
 */
Blob.prototype.overlap = function(blob) {
  var overlap = blob.r + this.r - this.distanceFromBlob(blob);
  return (overlap > 0 ? overlap : 0);
};

Blob.prototype.intersects = function(blob) {
  return this.distanceFromBlob(blob) < blob.r + this.r;
};

Blob.prototype.distanceFromBlob = function(blob) {
  return Math.sqrt(Math.pow(this.x - blob.x, 2) + Math.pow(this.y - blob.y, 2));
};

Blob.prototype.intersectsPaddle = function(paddle) {
  return this.insidePaddle(paddle);
};

Blob.prototype.insidePaddle = function(paddle) {
  var ballLeftEdge = this.x - this.r;
  var ballRightEdge = this.x + this.r;
  var ballTopEdge = this.y - this.r;
  var ballBottomEdge = this.y + this.r;
  var padLeftEdge = paddle.x;
  var padRightEdge = paddle.x + 100;

  // Bottom paddle case
  if (paddle.y == Game.HEIGHT - 25 - 25) { //TODO learn how to make constants for
                                           //things like this
    if ((ballLeftEdge < padRightEdge && ballLeftEdge > padLeftEdge &&
         ballTopEdge < paddle.y + 25 && ballBottomEdge > paddle.y) ||
        (ballRightEdge > padLeftEdge && ballRightEdge < padRightEdge &&
         ballTopEdge < paddle.y + 25 && ballBottomEdge > paddle.y )) {
      return true;
    }
  } else {
  // Top paddle case  
    if ((ballLeftEdge < padRightEdge && ballLeftEdge > padLeftEdge &&
         ballBottomEdge > paddle.y && ballTopEdge < paddle.y + 25) ||
        (ballRightEdge > padLeftEdge && ballRightEdge < padRightEdge &&
         ballBottomEdge > paddle.y && ballTopEdge < paddle.y + 25)) {
      return true;
    }
  }

  return false;

};

Blob.prototype.area = function() {
  return Math.PI * this.r * this.r;
};

/**
 * Transfers some area to (or from if area < 0) this blob.
 */
Blob.prototype.transferArea = function(area) {
  var sign = 1;
  if (area < 0) {
    sign = -1;
  }
  this.r += sign * Math.sqrt(Math.abs(area) / Math.PI);
};

/**
 * Create a new state for this blob in the future
 */
Blob.prototype.computeState = function(delta) {
  var newBlob = new this.constructor(this.toJSON());
  newBlob.x += this.vx * delta/10;
  newBlob.y += this.vy * delta/10;
  return newBlob;
};

Blob.prototype.toJSON = function() {
  var obj = {};
  for (var prop in this) {
    if (this.hasOwnProperty(prop)) {
      obj[prop] = this[prop];
    }
  }
  return obj;
};

Game.prototype.pauseBalls = function() {
  for (var i in this.state.objects) {
    this.state.objects[i].vx = 0;
    this.state.objects[i].vy = 0;
  }
};

Game.prototype.startBalls = function() {
  for (var i in this.state.objects) {
    if (this.state.objects[i].type == "blob") {
      this.state.objects[i].vx = 1;
      this.state.objects[i].vy = 1;
    }
  }
};

/**
 * Instance of a player (a paddle)
 */
var Player = function(params) {
  this.name = params.name;
  this.type = 'player';

  Blob.call(this, params);
};

Player.prototype = new Blob();
Player.prototype.constructor = Player;

exports.Game = Game;
exports.Player = Player;
exports.Blob = Blob;

})(typeof global === "undefined" ? window : exports);
