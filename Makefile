SHELL := /bin/sh
.DEFAULT_GOAL := restart

NODE ?= node
NPM ?= npm
GIT ?= git
NPM_REGISTRY ?= https://registry.npmjs.org/
NPM_PACKAGE ?= @wuwei0215/mcp-inspector
NPM_USER ?= wuwei0215
BUMP ?= minor
RUN_DIR := .run
PID_FILE := $(RUN_DIR)/mcp-inspector.pid
LOG_FILE := $(RUN_DIR)/mcp-inspector.log
APP_ENTRY := bin/mcp-inspector.mjs
LEGACY_PID_FILE ?= $(RUN_DIR)/dsers-inspector.pid
LEGACY_APP_ENTRY ?= bin/dsers-inspector.mjs

.PHONY: restart build deps start stop status logs release-version release-check publish help

restart:
	@$(MAKE) --no-print-directory build
	@$(MAKE) --no-print-directory stop
	@$(MAKE) --no-print-directory start

build: deps
	$(NPM) run build

deps:
	@$(NODE) -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 22) { console.error("Node.js 22 or newer is required"); process.exit(1); }'
	@if [ ! -x node_modules/.bin/vite ] || [ ! -x node_modules/.bin/tsup ]; then \
		echo "Installing dependencies..."; \
		$(NPM) install; \
	fi

start:
	@set -eu; \
	if [ ! -f dist/server/main.js ]; then \
		echo "Build output is missing; compiling first..."; \
		$(MAKE) --no-print-directory build; \
	fi; \
	mkdir -p "$(RUN_DIR)"; \
	if [ -f "$(PID_FILE)" ]; then \
		pid=$$(cat "$(PID_FILE)"); \
		command=$$(ps -p "$$pid" -o command= 2>/dev/null || true); \
		case "$$command" in \
			*"$(APP_ENTRY)"*) echo "MCP Inspector is already running (PID $$pid)."; exit 0 ;; \
		esac; \
		rm -f "$(PID_FILE)"; \
	fi; \
	nohup $(NODE) "$(APP_ENTRY)" > "$(LOG_FILE)" 2>&1 & \
	pid=$$!; \
	echo "$$pid" > "$(PID_FILE)"; \
	sleep 1; \
	if kill -0 "$$pid" 2>/dev/null; then \
		echo "MCP Inspector started (PID $$pid)."; \
		echo "The browser will open automatically. Logs: $(LOG_FILE)"; \
	else \
		echo "MCP Inspector failed to start. Recent logs:"; \
		tail -n 30 "$(LOG_FILE)" 2>/dev/null || true; \
		rm -f "$(PID_FILE)"; \
		exit 1; \
	fi

stop:
	@set -eu; \
	stopped=0; \
	for candidate in "$(PID_FILE)|$(APP_ENTRY)" "$(LEGACY_PID_FILE)|$(LEGACY_APP_ENTRY)"; do \
		pid_file=$${candidate%%|*}; \
		app_entry=$${candidate#*|}; \
		[ -f "$$pid_file" ] || continue; \
		pid=$$(cat "$$pid_file"); \
		command=$$(ps -p "$$pid" -o command= 2>/dev/null || true); \
		case "$$command" in \
			*"$$app_entry"*) ;; \
			*) echo "Removing stale PID file; no Inspector process was stopped."; rm -f "$$pid_file"; continue ;; \
		esac; \
		kill "$$pid"; \
		attempt=0; \
		while kill -0 "$$pid" 2>/dev/null && [ "$$attempt" -lt 10 ]; do \
			sleep 0.5; \
			attempt=$$((attempt + 1)); \
		done; \
		if kill -0 "$$pid" 2>/dev/null; then \
			echo "Inspector did not stop cleanly (PID $$pid)."; \
			exit 1; \
		fi; \
		rm -f "$$pid_file"; \
		stopped=1; \
		echo "MCP Inspector stopped (PID $$pid)."; \
	done; \
	if [ "$$stopped" -eq 0 ]; then echo "MCP Inspector is not running."; fi

status:
	@if [ -f "$(PID_FILE)" ]; then \
		pid=$$(cat "$(PID_FILE)"); \
		command=$$(ps -p "$$pid" -o command= 2>/dev/null || true); \
		case "$$command" in \
			*"$(APP_ENTRY)"*) echo "MCP Inspector is running (PID $$pid)."; exit 0 ;; \
		esac; \
	fi; \
	echo "MCP Inspector is not running."; \
	exit 1

logs:
	@mkdir -p "$(RUN_DIR)"
	@touch "$(LOG_FILE)"
	tail -f "$(LOG_FILE)"

release-version:
	@case "$(BUMP)" in \
		major|minor|patch) ;; \
		*) echo "BUMP must be major, minor, or patch."; exit 1 ;; \
	esac
	@test -z "$$($(GIT) status --porcelain)" || { echo "Release versioning requires a clean Git worktree."; exit 1; }
	$(NPM) version "$(BUMP)" -m "chore(release): v%s"

release-check:
	@set -eu; \
		$(NODE) -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 22) { console.error("Node.js 22 or newer is required"); process.exit(1); }'; \
		test -z "$$($(GIT) status --porcelain)" || { echo "Publishing requires a clean Git worktree."; exit 1; }; \
		package_name=$$($(NODE) -p 'require("./package.json").name'); \
		[ "$$package_name" = "$(NPM_PACKAGE)" ] || { echo "Unexpected npm package: $$package_name"; exit 1; }; \
		version=$$($(NODE) -p 'require("./package.json").version'); \
		$(GIT) tag --points-at HEAD | grep -Fqx "v$$version" || { echo "HEAD must have the release tag v$$version. Run make release-version BUMP=major|minor|patch first."; exit 1; }; \
		npm_user=$$($(NPM) whoami --registry=$(NPM_REGISTRY)); \
		[ "$$npm_user" = "$(NPM_USER)" ] || { echo "npm login must use $(NPM_USER) on $(NPM_REGISTRY)"; exit 1; }
	$(NPM) run verify
	$(NPM) audit --omit=dev --audit-level=high --registry=$(NPM_REGISTRY)
	$(NPM) pack --dry-run --registry=$(NPM_REGISTRY)

publish:
	@if [ "$(CONFIRM)" != "publish" ]; then \
		echo "Publishing is irreversible. Re-run with: make publish CONFIRM=publish"; \
		exit 1; \
	fi
	@$(MAKE) --no-print-directory release-check
	$(NPM) publish --access public --tag latest --registry=$(NPM_REGISTRY)

help:
	@echo "make / make restart  Install missing dependencies, rebuild, and restart"
	@echo "make start           Start the existing build in the background"
	@echo "make stop            Gracefully stop this project's Inspector process"
	@echo "make status          Show whether the Inspector is running"
	@echo "make logs            Follow the Inspector log (Ctrl-C to exit)"
	@echo "make build           Install missing dependencies and rebuild"
	@echo "make release-version BUMP=minor  Create a semantic version commit and Git tag"
	@echo "make release-check   Verify the tagged release without publishing"
	@echo "make publish CONFIRM=publish     Verify and publish to the official npm registry"
