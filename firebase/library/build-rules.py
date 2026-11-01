"""Generate deny-by-default RTDB rules for the htmltools2 Library project.

The libraryOwner claim is minted only by createLibrarySession after verifying
the old-project ID token and exact verified owner email. Browser-side
allowlists or email comparisons are never authorization.
"""
import json
from pathlib import Path

AUTH = "auth != null"
OWNER = "auth != null && auth.token.libraryOwner === true"
# The Library signs in directly against this data project, so "session" simply
# means "signed in" — no Cloud Function custom-token bridge is required.
SESSION = "auth != null"

def string(limit=200): return {".validate": f"newData.isString() && newData.val().length <= {limit}"}
def number(): return {".validate": "newData.isNumber() && newData.val() >= 0"}
def boolean(): return {".validate": "newData.isBoolean()"}

rules = {".read": False, ".write": False}

# Public aggregate mirrors. Counter writes are reserved for the Admin SDK;
# clients use callable functions so likes/views/playtime cannot be forged.
counter_fields = {k: {".write": False, ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() === (data.exists() ? data.val() : 0)"} for k in ["likes", "views", "playtimeSeconds", "ratingAvg", "ratingCount"]}
metadata_fields = {
    "title": string(200), "desc": string(2000), "ownerId": string(128), "ownerName": string(200),
    "createdAt": number(), "updatedAt": number(), "chatEnabled": boolean(), "chatScope": string(20),
    "allowViewCode": boolean(), "undeletable": boolean(), "platform": string(20),
    "logoImage": string(3000000), "bgImage": string(3000000),
    "collaborators": {"$key": {**string(200), "email": string(320)}},
}
for node in ["books", "bookStats"]:
    rules[node] = {
        ".read": True,
        "$id": {
            ".write": f"{OWNER} || ({SESSION} && !data.exists() && newData.child('ownerId').val() === auth.uid) || ({SESSION} && data.child('ownerId').val() === auth.uid && !newData.exists())",
            ".validate": "$id.matches(/^[A-Za-z0-9_-]{1,128}$/)",
            **metadata_fields, **counter_fields,
            "likedBy": {"$uid": {".read": f"{AUTH} && (auth.uid === $uid || {OWNER})", ".write": False, ".validate": "newData.val() === true"}},
            "$other": {".write": OWNER, ".validate": True},
        },
    }
    # Owners may edit their own lightweight metadata, but never counters.
    for field in metadata_fields:
        rules[node]["$id"][field][".write"] = f"{OWNER} || ({SESSION} && data.parent().child('ownerId').val() === auth.uid)"

# Game HTML source lives in books/$id/code so the Library keeps working even
# when the GitHub worker is unreachable. Only the book's owner may write it.
rules["books"]["$id"]["code"] = {
    ".write": f"{OWNER} || ({SESSION} && !data.exists() && newData.parent().child('ownerId').val() === auth.uid) || ({SESSION} && data.parent().child('ownerId').val() === auth.uid)",
    ".validate": "newData.isString() && newData.val().length <= 1100000",
}

rules["bookEngagement"] = {".read": False, ".write": False}
rules["engagementPreviews"] = {".read": False, ".write": False}
rules["engagementShares"] = {".read": False, ".write": False}
rules["userLikes"] = {"$uid": {".read": f"{AUTH} && auth.uid === $uid", ".write": False, "$id": {".validate": "newData.val() === true"}}}

rules["users"] = {
    ".read": OWNER,
    "$uid": {
        ".read": f"{AUTH} && (auth.uid === $uid || {OWNER})",
        ".write": f"{OWNER} || ({SESSION} && auth.uid === $uid)",
        "uid": string(128), "email": string(320), "displayName": string(200),
        "joinedAt": number(), "lastSignIn": number(), "totalTimeSeconds": number(),
        "$other": {".validate": True},
    },
}
rules["comments"] = {
    "$book": {
        ".read": True,
        ".indexOn": ["createdAt"],
        "$comment": {
            ".write": f"{OWNER} || ({SESSION} && !data.exists() && newData.child('authorId').val() === auth.uid) || ({SESSION} && data.child('authorId').val() === auth.uid && !newData.exists()) || ({SESSION} && root.child('bookStats').child($book).child('ownerId').val() === auth.uid && !newData.exists())",
            ".validate": "newData.hasChildren(['text','authorId','createdAt'])",
            "text": string(500), "authorId": string(128), "authorName": string(200), "createdAt": number(),
            "$other": {".validate": False},
        },
    }
}
rules["commentCounts"] = {".read": True, "$book": {".write": SESSION, **number()}}
rules["ratings"] = {
    ".read": True,
    "$book": {"$uid": {".write": f"{SESSION} && auth.uid === $uid", ".validate": "newData.hasChildren(['rating'])", "rating": {".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 5"}, "ratedAt": number(), "$other": {".validate": False}}},
}
rules["notifications"] = {"$uid": {".read": f"{AUTH} && auth.uid === $uid", ".write": f"{AUTH} && (auth.uid === $uid || {SESSION})", "$id": {".validate": "newData.hasChildren(['createdAt'])", "$other": {".validate": True}}}}
rules["chat"] = {
    ".read": "query.orderByKey && query.limitToLast != null && query.limitToLast <= 60",
    ".indexOn": ["sentAt"],
    "$message": {
        ".write": f"{OWNER} || ({SESSION} && !data.exists() && newData.child('senderId').val() === auth.uid) || ({SESSION} && data.child('senderId').val() === auth.uid && !newData.exists())",
        ".validate": "newData.hasChildren(['text','senderId','sentAt'])",
        "text": string(400), "senderId": string(128), "senderName": string(200), "sentAt": number(),
        "autoDelete": boolean(), "deleted": boolean(),
        "isAdmin": {".validate": f"newData.val() === false || {OWNER}"},
        "$other": {".validate": False},
    },
}
rules["projectChat"] = {"$book": {".read": f"{SESSION} && query.limitToLast != null && query.limitToLast <= 30", "$message": {".write": f"{OWNER} || ({SESSION} && newData.child('senderId').val() === auth.uid) || ({SESSION} && data.child('senderId').val() === auth.uid)", "text": string(500), "senderId": string(128), "senderName": string(200), "sentAt": number(), "$other": {".validate": False}}}}
rules["bannedUsers"] = {".read": True, ".write": OWNER, "$uid": {"bannedAt": number(), "bannedBy": string(128), "name": string(200), "$other": {".validate": True}}}
rules["forceSignout"] = {"$uid": {".read": f"{AUTH} && (auth.uid === $uid || {OWNER})", ".write": f"{OWNER} || ({AUTH} && auth.uid === $uid && !newData.exists())", "$other": {".validate": True}}}
rules["recentlyDeleted"] = {".read": OWNER, ".write": OWNER, "$id": {"$other": {".validate": True}}}
rules["activityLog"] = {".read": OWNER, ".write": OWNER, "$id": {"$other": {".validate": True}}}
rules["bookMirror"] = {".read": OWNER, ".write": OWNER, "$id": {"$other": {".validate": True}}}
rules["bookCode"] = {"$id": {".read": f"{OWNER} || ({SESSION} && root.child('bookStats').child($id).child('ownerId').val() === auth.uid)", ".write": OWNER, "$other": {".validate": True}}}
rules["playSessions"] = {".read": OWNER, ".write": False}
rules["siteConfig"] = {
    ".read": OWNER,
    "announcement": {".write": OWNER, ".read": True, "$other": {".validate": True}},
    "loginDisabled": {".write": OWNER, ".read": True, ".validate": "newData.isBoolean()"},
    "signupDisabled": {".write": OWNER, ".read": True, ".validate": "newData.isBoolean()"},
    "maintenance": {".write": OWNER, ".read": True, ".validate": "newData.isBoolean()"},
    "pinnedBooks": {".write": OWNER, ".read": True, "$id": {".validate": "newData.val() === true"}},
    "deletedOldBooks": {".write": OWNER, ".read": True, "$id": {".validate": "newData.val() === true"}},
    "adminEmails": {".read": OWNER, ".write": False},
    "$other": {".read": OWNER},
}
Path(__file__).with_name("database.rules.json").write_text(json.dumps({"rules": rules}, indent=2) + "\n")
