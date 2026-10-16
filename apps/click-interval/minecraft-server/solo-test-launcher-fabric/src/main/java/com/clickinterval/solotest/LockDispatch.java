package com.clickinterval.solotest;

import java.util.Set;

/** A closed command vocabulary; text fields cannot inject another command. */
final class LockDispatch {
    static String command(String target,String action,String duration) {
        if(!Set.of("endlock","netherlock").contains(target) || !Set.of("on","off","status","for").contains(action))
            throw new IllegalArgumentException("Unknown dimension or action");
        if(!action.equals("for")) {
            if(duration!=null && !duration.isEmpty()) throw new IllegalArgumentException("Unexpected duration");
            return target+" "+action;
        }
        String value=duration==null?"":duration.trim();
        if(!value.matches("[1-9][0-9]{0,8}[smhd]")) throw new IllegalArgumentException("Use a duration such as 30s, 10m, 2h or 1d");
        long amount=Long.parseLong(value.substring(0,value.length()-1));
        long unit=switch(value.charAt(value.length()-1)) { case 's'->1; case 'm'->60; case 'h'->3600; case 'd'->86400; default->throw new IllegalArgumentException(); };
        if(amount*unit>365L*86400L) throw new IllegalArgumentException("Duration must be between 1 second and 365 days");
        return target+" for "+value;
    }
}
