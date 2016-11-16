### `postgresql-query`
`Querying PostgreSQL with Node.js made easy.`

&nbsp;

*Created by: [Lasha Tavartkiladze](https://github.com/coloraggio) at [Elva](https://elva.org)*  
*License: MIT*

&nbsp;

## config()
Require and prepare module for querying.

```js
var db = require('postgersql-query');

db.config({
    username: '',
    password: '',
    host: '',
    database: '' 
});
```

## query()
Query a database and get results in a callback function.  
```
db.query(sql, values, callback);
```
```js
db.query('SELECT * FROM albums WHERE artist_id = $1', 47, function (err, albums) {
    
});
```
Or run multiple queries in specified order and get all results in a finalCallback functions.
```
db.query(tasks, finalCallback);
```
```js
db.query([
    ['SELECT * FROM albums WHERE artist_id = $1', 47],
    ['SELECT * FROM genres WHERE artist_id = $1 AND mood = $2', [47, 'sad']],
    ['SELECT * FROM comments WHERE artist_id = $1', [47]]
], function (err, albums, genres, comments) {
        
});
```

## queryOne()
Query a database and use only the first row.
```
db.queryOne(sql, values, callback);
```
```js
db.queryOne('SELECT * FROM artists WHERE id = $1', 47, function (err, artist) {
    // artist.name
});
```

## queryInsert()
Helper function to make it easy writing INSERT queries.
```js
db.queryInsert({
    table: 'artists',
    fields: {
        first_name: 'John',
        last_name: 'Doe',
        country: 'Italy'
    },
    returnValue: '*'
}, function (err, insertedRow) {
    
});
```
Above is similar to this:
```js
db.queryOne('INSERT INTO artists (first_name, last_name, country) VALUES ($1, $2, $3) RETURNING *', ['John', 'Doe', 'Italy'], function (err, insertedRow) {
    
});
```

## queryUpdate()

## beginTransaction();
