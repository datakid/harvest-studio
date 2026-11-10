export const createHistory = (limit = 100) => {
  let past = [];
  let future = [];
  let busy = false;
  const api = {
    push(entry) {
      past.push(entry);
      if (past.length > limit) past.shift();
      future = [];
    },
    async undo() {
      if (busy || !past.length) return false;
      busy = true;
      try {
        const entry = past.pop();
        await entry.undo();
        future.push(entry);
        return true;
      } finally {
        busy = false;
      }
    },
    async redo() {
      if (busy || !future.length) return false;
      busy = true;
      try {
        const entry = future.pop();
        await entry.redo();
        past.push(entry);
        return true;
      } finally {
        busy = false;
      }
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past = [];
      future = [];
    }
  };
  return api;
};
