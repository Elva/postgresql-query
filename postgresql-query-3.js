'use strict';


let pg = require('pg');
let pool;


//
// Prepare module for querying.
//
function config(options) {
    options = options || {};

    options.user     = options.username = options.username || 'postgres';
    options.password = options.password || '';
    options.host     = options.host || '127.0.0.1';
    options.port     = options.port || 5432;
    options.database = options.database || 'postgres';

    if (options.ssl === true) {
        options.ssl = { rejectUnauthorized: false };
    }

    pool = new pg.Pool(options);
    module.exports.pool = pool;
}
module.exports.config = config;


//
// Wrapper for queryStandard(), queryObject() and queryArray()
//
function query(...args) {
    let q = args[0];
    let callback = args[args.length - 1];

    if (typeof q === 'string') {
        return queryStandard.apply(null, args);
    } else if (isObject(q)) {
        return queryObject.apply(null, args);
    } else if (Array.isArray(q)) {
        return queryArray.apply(null, args);
    } else {
        let pr = genericPromise();
        let err = { error: 'Invalid query type' };
        if (isFunction(callback)) {
            callback(err, null);
        } else {
            pr.reject(err);
        }
        return pr.promise;
    }
}
module.exports.query = query;


// Query a database with an SQL string and optional parameters.
//
// query(sql, values, callback)
//
//    query('SELECT * FROM albums WHERE artist_id = $1', 47, function (err, albums) {
//    
//    });
//
// await query(sql, values);
//
//    (async function () {
//        let albums   = await query('SELECT * FROM albums WHERE artist_id = $1', 47);
//        let genres   = await query('SELECT * FROM genres WHERE artist_id = $1 AND mood = $2', [47, 'sad']);
//        let comments = await query('SELECT * FROM comments WHERE artist_id = $1', [47]);
//    })();
//
function queryStandard(sql, ...args) {
    let callback = args[args.length - 1];
    let hasCallback = isFunction(callback);
    let values = hasCallback ? args.slice(0, args.length - 1) : args;
    let pr = genericPromise();

    (async function () {
        let client;

        try {
            client = await pool.connect();
            let result = await client.query(sql, flatArray(values));
            if (hasCallback) {
                callback(null, result.rows);
            } else {
                pr.resolve(result.rows);
            }
        } catch (err) {
            if (hasCallback) {
                callback(err, null);
            } else {
                pr.reject(err);
            }
        } finally {
            if (client) {
                client.release();
            }
        }
    })();

    return pr.promise;
}


//
// Run queries built by buildInsertQuery() and buildUpdateQuery() functions
//
function queryObject(obj, callback) {
    let hasCallback = isFunction(callback);
    let pr = genericPromise();

    (async function () {
        let client;
        
        try {
            client = await pool.connect();
            let q = obj.where ? buildUpdateQuery(obj) : buildInsertQuery(obj);
            let result = await client.query(q.sql, q.values);
            if (hasCallback) {
                callback(null, result.rows);
            } else {
                pr.resolve(result.rows);
            }
        } catch (err) {
            if (hasCallback) {
                callback(err, null);
            } else {
                pr.reject(err);
            }
        } finally {
            if (client) {
                client.release();
            }
        }
    })();

    return pr.promise;
}


//
// Run multiple queries in specified order and get all results together.
//
//    queryArray([
//        ['SELECT * FROM albums WHERE artist_id = $1', 47],
//        ['SELECT * FROM genres WHERE artist_id = $1 AND mood = $2', [47, 'sad']],
//        ['SELECT * FROM comments WHERE artist_id = $1', [47]]
//    ], function (err, albums, genres, comments) {
//        
//    });
//
function queryArray(list, callback) {
    let hasCallback = isFunction(callback);
    let pr = genericPromise();

    (async function () {
        let client;
        
        try {
            client = await pool.connect();
            let results = [];
            for (let item of list) {
                let sql, values;
                if (isObject(item)) {
                    let q = item.where ? buildUpdateQuery(item) : buildInsertQuery(item);
                    sql = q.sql;
                    values = q.values;
                } else {
                    sql = item[0];
                    values = item.slice(1);
                }
                let result = await client.query(sql, flatArray(values));
                results.push(result.rows);
            }
            if (hasCallback) {
                callback.apply(null, [null].concat(results));
            } else {
                pr.resolve(results);
            }
        } catch (err) {
            if (hasCallback) {
                callback(err, null);
            } else {
                pr.reject(err);
            }
        } finally {
            if (client) {
                client.release();
            }
        }
    })();

    return pr.promise;
}


function newTransaction(callback) {
    let hasCallback = isFunction(callback);
    let pr = genericPromise();
    
    (async function () {
        try {
            let client = await pool.connect();
            await client.query('BEGIN');
            let transaction = getTransactionObject(client);

            if (hasCallback) {
                callback(null, transaction);
            } else {
                pr.resolve(transaction);
            }
        } catch (err) {
            if (client) {
                client.release();
            }
            if (hasCallback) {
                callback(err, null);
            } else {
                pr.reject(err);
            }
        }
    })();

    return pr.promise;
}
module.exports.transaction = newTransaction;
module.exports.beginTransaction = newTransaction;


function getTransactionObject(client) {
    var transaction = {
        isActive: true,
        client: client
    };
    ['rollback', 'commit'].forEach(function (sqlCommand) {
        transaction[sqlCommand.toLowerCase()] = function (callback) {
            let hasCallback = isFunction(callback);
            let pr = genericPromise();
            client.query(sqlCommand.toUpperCase(), function (err) {
                client.release();
                transaction.isActive = false;
                if (err) {
                    if (hasCallback) {
                        callback(err, null);
                    } else {
                        pr.reject(err);
                    }
                    return;
                }
                if (hasCallback) {
                    callback(null);
                } else {
                    pr.resolve();
                }
            });
            return pr.promise;
        };
    });
    transaction.query = function (...args) {
        let q = args[0];
        let callback = args[args.length - 1];

        if (typeof q === 'string') {
            return transactionQueryStandard.apply(null, args);
        } else if (isObject(q)) {
            return transactionQueryObject.apply(null, args);
        } else if (Array.isArray(q)) {
            return transactionQueryArray.apply(null, args);
        } else {
            let pr = genericPromise();
            let err = { error: 'Invalid query type' };
            if (isFunction(callback)) {
                callback(err, null);
            } else {
                pr.reject(err);
            }
            return pr.promise;
        }
    }
    function transactionQueryStandard(sql, ...args) {
        let callback = args[args.length - 1];
        let hasCallback = isFunction(callback);
        let values = hasCallback ? args.slice(0, args.length - 1) : args;
        let pr = genericPromise();

        (async function () {
            try {
                let result = await client.query(sql, flatArray(values));
                if (hasCallback) {
                    callback(null, result.rows);
                } else {
                    pr.resolve(result.rows);
                }
            } catch (err) {
                if (hasCallback) {
                    callback(err, null);
                } else {
                    pr.reject(err);
                }
            }
        })();

        return pr.promise;
    }
    function transactionQueryObject(obj, callback) {
        let hasCallback = isFunction(callback);
        let pr = genericPromise();

        (async function () {
            try {
                let q = obj.where ? buildUpdateQuery(obj) : buildInsertQuery(obj);
                let result = await client.query(q.sql, q.values);
                if (hasCallback) {
                    callback(null, result.rows);
                } else {
                    pr.resolve(result.rows);
                }
            } catch (err) {
                if (hasCallback) {
                    callback(err, null);
                } else {
                    pr.reject(err);
                }
            }
        })();

        return pr.promise;
    }
    function transactionQueryArray(list, callback) {
        let hasCallback = isFunction(callback);
        let pr = genericPromise();

        (async function () {
            try {
                let results = [];
                for (let item of list) {
                    let sql, values;
                    if (isObject(item)) {
                        let q = item.where ? buildUpdateQuery(item) : buildInsertQuery(item);
                        sql = q.sql;
                        values = q.values;
                    } else {
                        sql = item[0];
                        values = item.slice(1);
                    }
                    let result = await client.query(sql, flatArray(values));
                    results.push(result.rows);
                }
                if (hasCallback) {
                    callback.apply(null, [null].concat(results));
                } else {
                    pr.resolve(results);
                }
            } catch (err) {
                if (hasCallback) {
                    callback(err, null);
                } else {
                    pr.reject(err);
                }
            }
        })();

        return pr.promise;
    }
    return transaction;
}


//
// Semantic wrappers for queryObject()
//
['insert', 'update'].forEach(function (funcName) {
    module.exports[funcName] = function (obj, callback) {
        if (isObject(obj)) {
            return queryObject.call(null, obj, callback);
        } else {
            let pr = genericPromise();
            let err = { error: 'Invalid parameters for ' + funcName + '()' };
            if (isFunction(callback)) {
                callback(err, null);
            } else {
                pr.reject(err);
            }
            return pr.promise;
        }
    };
});


//
// Deprecated
// Same as insert() and update() except they return single row instead of a list of rows
//
['queryInsert', 'queryUpdate'].forEach(function (funcName) {
    module.exports[funcName] = function (obj, callback) {
        let hasCallback = isFunction(callback);
        let pr = genericPromise();

        if (isObject(obj)) {
            queryObject(obj, function (err, rows) {
                if (err) {
                    if (hasCallback) {
                        callback(err, null);
                    } else {
                        pr.reject(err);
                    }
                    return;
                }
                if (hasCallback) {
                    callback(null, rows[0]);
                } else {
                    pr.resolve(rows[0]);
                }
            });
        } else {
            let err = { error: 'Invalid parameters for ' + funcName + '()' };
            if (hasCallback) {
                callback(err, null);
            } else {
                pr.reject(err);
            }
        }
        return pr.promise;
    };
});


//
// Same as query() but only returns the first row.
// Usefull when doing queries like 'SELECT * FROM table WHERE id = x'
//
function queryOne(...args) {
    let callback = args[args.length - 1];
    let hasCallback = isFunction(callback);
    let pr = genericPromise();

    args = hasCallback ? args.slice(0, args.length - 1) : args;
    args.push(onResult);
    query.apply(null, args);

    function onResult(err, rows) {
        if (err) {
            if (hasCallback) {
                callback(err, null);
            } else {
                pr.reject(err);
            }
            return;
        }
        if (hasCallback) {
            callback(null, rows[0]);
        } else {
            pr.resolve(rows[0]);
        }
    }

    return pr.promise;
}
module.exports.queryOne = queryOne;


//
// Query builder for INSERT statement.
//
//    buildInsertQuery({
//        table: 'user',
//        fields: {
//            first_name: 'John',
//            last_name: 'Doe',
//            email: 'example@example.com'
//        },
//        returnValue: 'user_id'
//    });
//    
//    Returns:
//    {
//        sql: 'INSERT INTO user ( first_name, last_name, email ) VALUES ( $1, $2, $3 ) RETURNING user_id',
//        values: ['John', 'Doe', 'example@example.com']
//    }
//
function buildInsertQuery(data) {
    let sql = 'INSERT INTO ' + data.table + ' ( ';
    let fields = Object.keys(data.fields);
    let pIndex = 0;
    let values = [];

    fields.forEach(function (field, i) {
        let isLastField = (fields.length === i + 1);
        sql += field + (isLastField ? ' ' : ', ');
    });

    sql += ') VALUES ( ';

    fields.forEach(function (field, i) {
        let isLastField = (fields.length === i + 1);
        let val = data.fields[field];

        if (field === 'sort_order' && val === 'auto') {
            sql += '(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM ' + data.table + ')';
        } else {
            sql += '$' + (pIndex += 1);
            values.push(val);
        }

        sql += isLastField ? ' ' : ', ';
    });

    sql += ')';

    if (data.returnValue) {
        sql += ' RETURNING ' + data.returnValue;
    }

    return { sql : sql, values: values };
}


//
// Query builder for UPDATE statement.
//
//    buildUpdateQuery({
//        table: 'user',
//        fields: {
//            first_name: 'John',
//            last_name: 'Doe',
//            email: 'example@example.com'
//        },
//        where: {
//            userId: 47
//        }
//    });
//
//    Returns:
//    {
//       sql: 'UPDATE user SET first_name = $1, last_name = $2, email = $3  WHERE id = $4',
//       values: ['John', 'Doe', 'example@example.com', 47]
//    }
//
function buildUpdateQuery(data) {
    let sql = 'UPDATE ' + data.table + ' SET ';
    let fields = Object.keys(data.fields);
    let where  = Object.keys(data.where);
    let values = [];

    fields.forEach(function (field, i) {
        let pIndex = i + 1;
        let isLastField = (fields.length === pIndex);
        let val = data.fields[field];

        if (isObject(val) && Object.keys(val).length) { 
            // Concatanate JSON data instead of replacing it.
            sql += field + ' = ' + field + ' || $' + pIndex; 
        } else {
            sql += field + ' = $' + pIndex;
        }

        sql += isLastField ? ' ' : ', ';
        values.push(val);
    });

    sql += ' WHERE ';

    where.forEach(function (field, i) {
        let pIndex = fields.length + i + 1;
        let isLastField = (where.length === i + 1);

        sql += field + ' = $' + pIndex + (isLastField ? ' ' : ' AND ');
        values.push(data.where[field]);
    });

    if (data.returnValue) {
        sql += ' RETURNING ' + data.returnValue;
    }

    return { sql: sql, values: values };
}


//
// Convert any number of multi-diemensional array-like objects 
// into a single flat array.
//
// Example:
//   flatArray(1, 2, [3, 4, [5]], '6', ['7'], { num: 8 }, [9], 10);
//      => [1, 2, 3, 4, 5, '6', '7', { num: 8 }, 9, 10]
//
function flatArray() {
    let flat = [], i, arg, isArrayLike;

    for (i = 0; i < arguments.length; i += 1) {
        arg = arguments[i];
        isArrayLike = arg && typeof arg === 'object' && arg.length !== undefined;

        if (isArrayLike) {
            flat = flat.concat(flatArray.apply(null, arg));
        } else {
            flat.push(arg);
        }
    }

    return flat;
}


//
// Check if variable is a valid object.
//
function isObject(obj) {
    return Object.prototype.toString.call(obj) === '[object Object]';
}


//
// Check if variable is a valid function.
//
function isFunction(obj) {
    return typeof obj === 'function';
}


//
// Create a handy reference object for a promise
//
function genericPromise() {
    let resolve, reject;
    let promise = new Promise(function (rs, rj) { resolve = rs; reject = rj; });
    return {
        promise: promise,
        resolve: resolve,
        reject: reject
    };
}