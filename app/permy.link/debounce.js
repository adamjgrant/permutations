var debounce, debounceQueue;

debounceQueue = {};

debounce = function(fn, id, delay, args, that) {
  delay = delay || 1000;
  that = that || this;
  args = args || new Array();
  if (typeof debounceQueue[id] !== "object") {
    debounceQueue[id] = new Object();
  }
  if (typeof debounceQueue[id].debounceTimer !== "undefined") {
    clearTimeout(debounceQueue[id].debounceTimer);
  }
  return debounceQueue[id] = {
    fn: fn,
    id: id,
    delay: delay,
    args: args,
    debounceTimer: setTimeout(function() {
      debounceQueue[id].fn.apply(that, debounceQueue[id].args);
      return debounceQueue[id] = void 0;
    }, delay)
  };
};