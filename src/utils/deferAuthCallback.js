// Supabase invokes onAuthStateChange callbacks while its auth client may still
// hold an internal lock. Calling another Supabase method synchronously from
// that callback can deadlock the original sign-in promise even after the HTTP
// token request has returned successfully.
//
// This wrapper keeps the callback synchronous from Supabase's perspective and
// schedules all application side effects for the next macrotask.
export const deferAuthCallback = (
    callback,
    schedule = (task) => setTimeout(task, 0),
    onError = (error) => console.error('[auth] deferred callback failed:', error),
) => {
    if (typeof callback !== 'function') {
        throw new TypeError('deferAuthCallback requires a callback');
    }

    return (event, session) => {
        schedule(() => {
            Promise.resolve()
                .then(() => callback(event, session))
                .catch(onError);
        });
    };
};

export default deferAuthCallback;
