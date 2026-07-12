#!/usr/bin/env bash
# test-slot — thin shim onto the BOX-WIDE governor.
#
# This used to be a PROGRAM-LOCAL semaphore. That was not enough: both programs on this box
# capped themselves independently, each was disciplined, and the box still ran 10 suites on
# 20 cores (load 29) because neither could see the other. Two local caps do not compose into
# a box governor. Every suite — from EITHER program — now passes through one shared lock.
#
# Usage is unchanged: scripts/test-slot.sh <any test command>
exec /home/jameson/lantern-coordination/box-test-slot.sh "$@"
