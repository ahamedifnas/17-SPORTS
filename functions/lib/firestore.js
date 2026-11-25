"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FieldPath = exports.FieldValue = exports.getFirestore = void 0;
// Single server database boundary, replaceable by isolated transaction tests.
var firestore_1 = require("firebase-admin/firestore");
Object.defineProperty(exports, "getFirestore", { enumerable: true, get: function () { return firestore_1.getFirestore; } });
Object.defineProperty(exports, "FieldValue", { enumerable: true, get: function () { return firestore_1.FieldValue; } });
Object.defineProperty(exports, "FieldPath", { enumerable: true, get: function () { return firestore_1.FieldPath; } });
