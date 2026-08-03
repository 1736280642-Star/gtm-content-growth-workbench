let mutationTail: Promise<void> = Promise.resolve();

export function serializePublishMutation<T>(action: () => Promise<T> | T): Promise<T> {
  const result = mutationTail.then(action, action);
  mutationTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
