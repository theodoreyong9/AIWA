[package]
name = "aiwa-core"
version = "0.1.0"
edition = "2021"
description = "AIWA reference ledger core (DAG of events, materialized economic view). Compiled to WASM."

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "=0.2.92"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde-wasm-bindgen = "0.6"
sha2 = "0.10"

[profile.release]
opt-level = "z"
lto = true
