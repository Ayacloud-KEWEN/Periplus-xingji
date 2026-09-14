export function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

export function parseId(value) {
    if (!/^\d+$/.test(String(value))) throw httpError(400, 'invalid id');
    return Number(value);
}
