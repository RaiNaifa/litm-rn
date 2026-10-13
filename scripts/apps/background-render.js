const pending = new WeakMap();

/** Merge background updates for one open application without opening or raising it. */
export function requestBackgroundRender(application, options = {}) {
	if (!application?.rendered) return Promise.resolve(application);
	let state = pending.get(application);
	if (options.litmPeer && state?.promise) return state.promise;
	if (!state) {
		state = { options: null, promise: null };
		pending.set(application, state);
	}
	if (!state.options)
		state.options = { ...options, force: false, litmScheduled: true };
	else {
		const previous = state.options;
		state.options = {
			...previous,
			...options,
			force: false,
			litmScheduled: true,
		};
		if (previous.parts && options.parts)
			state.options.parts = [...new Set([...previous.parts, ...options.parts])];
		else delete state.options.parts;
	}
	if (state.promise) return state.promise;
	state.promise = new Promise((resolve, reject) => {
		const frame =
			globalThis.requestAnimationFrame ??
			((callback) => setTimeout(callback, 0));
		frame(async () => {
			try {
				while (state.options && application.rendered) {
					const renderOptions = state.options;
					state.options = null;
					await application.render(renderOptions);
				}
				resolve(application);
			} catch (error) {
				reject(error);
			} finally {
				state.options = null;
				state.promise = null;
			}
		});
	});
	return state.promise;
}
