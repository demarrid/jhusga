export const SESSION_NUMBER = 114;
export function getSessionString() {
    const ones = SESSION_NUMBER % 10;

    if (ones === 1) {
        return `${SESSION_NUMBER}st`;
    } else if (ones === 2) {
        return `${SESSION_NUMBER}nd`;
    } else if (ones === 3) {
        return `${SESSION_NUMBER}rd`;
    } else {
        return `${SESSION_NUMBER}th`;
    }
}