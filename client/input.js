(function(exports) {
/**
 * Desktop input handler (ie. mouse, keyboard)
 * with some touch support as well.
 */

function DesktopInput(game) {
  this.game = game;
  var ctx = this;

  // Mouse paddle movement
  canvas.addEventListener('mousemove', function(e) {
    _gaq.push(['_trackEvent', 'MouseMove']);
    ctx.onmousemove.call(ctx, e);
  });

  // Touch paddle movement
  canvas.addEventListener('touchmove', function(e) {
    _gaq.push(['_trackEvent', 'TouchMove']);
    ctx.ontouch.call(ctx, e);
  });

  // Touch paddle movement
  canvas.addEventListener('touchstart', function(e) {
    _gaq.push(['_trackEvent', 'TouchMove']);
    ctx.ontouch.call(ctx, e);
  });

  // Bind to the join button
  var join = document.getElementById('join');
  join.addEventListener('click', function(e) {
    _gaq.push(['_trackEvent', 'Join']);
    ctx.onjoin.call(ctx, e);
  });

  // Bind to music button.
  var music = document.getElementById('music');
  music.addEventListener('click', function(e) {
    _gaq.push(['_trackEvent', 'Toggle Music']);
    ctx.onmusic.call(ctx, e);
  });
}

DesktopInput.prototype.onjoin = function() {
  if (!playerId) {
    smoke.prompt("What is your name?", function(name) {
      if (name) {
        socket.emit('join', {name: name});
        document.querySelector('#join').style.display = 'none';
      } else {
        smoke.signal('sorry, name required');
      }
    });
  }
};

DesktopInput.prototype.onmusic = function() {
  sound.toggleSoundtrack();
};

DesktopInput.prototype.onleave = function() {
  socket.emit('leave', {name: playerId});
};

DesktopInput.prototype.onmousemove = function(event) {
  // Get the position of the click.
  var cx = event.clientX - event.target.getBoundingClientRect().left;
  // Get the current player.
  var player = this.game.state.objects[playerId];
  // Sometimes the player isn't there.
  if (!player) {
    return;
  }
  // Consider where the player is positioned.
  var px = player.x;
  // Send the corresponding move() command
  socket.emit('move', {mouseX: cx, playerX: px});
}

DesktopInput.prototype.ontouch = function(event) {
  event.preventDefault();
  // Get the position of the click.
  var cx = event.targetTouches[0].clientX - 
           event.target.getBoundingClientRect().left;
  // Get the current player.
  var player = this.game.state.objects[playerId];
  // Sometimes the player isn't there.
  if (!player) {
    return;
  }
  // Consider where the player is positioned.
  var px = player.x;
  // Send the corresponding move() command
  socket.emit('move', {mouseX: cx, playerX: px});
}

DesktopInput.prototype.onclick = function(event) {
  // Get the position of the click.
  var cx = event.clientX - event.target.getBoundingClientRect().left;
  var cy = event.clientY - event.target.getBoundingClientRect().top;
  // Get the current player.
  var player = this.game.state.objects[playerId];
  // Sometimes the player isn't there.
  if (!player) {
    return;
  }
  // Consider where the player is positioned.
  var px = player.x;
  var py = player.y;
  // Get the angle of the shot
  var angle = Math.atan2(cy - py, cx - px);
  // Send the corresponding shoot() command.
  socket.emit('shoot', { direction: angle });
};

exports.Input = DesktopInput;

})(window);
